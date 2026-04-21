# High-Level System Design

## Purpose

This document describes a lean scalable architecture for implementing the exchange defined in [engineering-case-marcelo.md](/Users/marcelomarchetto/Desktop/decade/docs/engineering-case-marcelo.md).

It keeps the core exchange invariants required for a scalable system:

- deterministic price-time-priority matching
- single writer per symbol
- durable order acceptance
- horizontal scale across symbols
- recovery after failure

## Scope

The required core behavior is:

- brokers submit buy and sell orders
- the system assigns an exchange order identifier
- brokers can query order status later by identifier
- orders are matched by symbol, price, validity, and time priority
- partial fills are supported
- execution price is the seller price whenever bid and ask cross

Out of scope for this design:

- brokerage accounts and balances
- custody and settlement
- KYC, AML, and customer compliance workflows
- advanced market mechanisms such as market orders or auctions
- multi-region active-active deployment

## Design Goals

### Functional goals

- preserve price-time priority for every symbol
- support partial fills and resting orders
- prevent expired orders from trading
- expose a broker-facing API that is simple to consume

### Non-functional goals

- scale broker-facing traffic independently from matching throughput
- guarantee one active writer per symbol
- keep the edge tier horizontally scalable with autoscaling
- keep the engine tier horizontally scalable within a fixed partition count
- survive process crashes and duplicate delivery
- keep the design operationally small enough to build and explain clearly

## Core Invariants

### 1. Single writer per symbol

For any given symbol, matching must happen through exactly one active engine owner at a time.

This guarantees:

- deterministic price-time priority
- no concurrent write races inside one order book
- simpler recovery and replay semantics

### 2. Authoritative ordering comes from the engine path

Client timestamps are not authoritative.

The authoritative order for matching is the order in which the owning engine consumer processes commands for that symbol from the ordered command stream.

The broker API may assign:

- a public order identifier
- an acceptance timestamp

But the matching engine owns the ordering that determines fill priority.

### 3. Successful submission requires persistence and publish

The broker API should acknowledge an order only after:

- the order has been persisted in PostgreSQL
- the `SubmitOrder` command has been accepted by Kafka

This keeps the API asynchronous from the matching point of view while still ensuring the engine has a command to process.

### 4. In-memory books, durable outcomes

Active order books live in memory inside the matching engine for speed.

Durable state lives in PostgreSQL:

- current order state
- trade executions
- immutable order events
- idempotency records
- processed command records for deduplication

### 5. Same ordered path for submission and expiration

Expiration must not bypass the engine and mutate live orders directly.

Order submissions and expiration commands must both flow through the same symbol-partitioned command path.

## Target Architecture

The system is split into two deployable workloads plus two shared infrastructure dependencies.

### Workloads

- `broker-api`
- `matching-engine`

### Shared infrastructure

- PostgreSQL
- Kafka

## Main Components

### Broker API

Responsibilities:

- expose `POST /orders`
- expose `GET /orders/{order_id}`
- validate requests
- enforce idempotency
- persist accepted orders into PostgreSQL
- publish `SubmitOrder` directly to Kafka keyed by `symbol`
- serve reads directly from PostgreSQL

This service is stateless from the HTTP perspective and can scale horizontally behind a load balancer or an HPA.

### Command bus

Kafka is used as the ordered command path between the edge and the engine.

Responsibilities:

- preserve per-symbol ordering
- allow independent scaling across symbols
- decouple broker traffic from matching throughput
- define the fixed parallelism of the engine tier

Every command is keyed by `symbol`, including:

- `SubmitOrder`
- `ExpireOrder`

The topic should use a fixed number of partitions.

That partition count defines the maximum active parallelism of the matching tier:

- each partition can be owned by only one engine consumer at a time
- one symbol always maps to one partition
- adding engine replicas beyond the partition count improves availability, not throughput

### Matching engine

Responsibilities:

- consume symbol-partitioned commands from Kafka
- own in-memory order books for its assigned partitions
- apply deterministic matching rules
- persist updated order state, trades, and events
- reject duplicate command processing safely
- rebuild books from durable live state after restart
- run the expiration scheduler for the system

This service is internally stateful because it owns live in-memory books, but it remains horizontally scalable across Kafka partitions.

Its scaling model is different from the API tier:

- `broker-api` can autoscale freely based on HTTP load
- `matching-engine` scales horizontally only up to the fixed partition count
- each extra engine replica takes ownership of some partitions until all partitions are assigned

### Embedded expiration scheduler

There is no separate `expiration-worker` service in this version.

Instead, `matching-engine` includes a scheduler component that:

- periodically scans PostgreSQL for due open orders
- acquires a lease or advisory lock so only one scheduler is active at a time
- emits `ExpireOrder` commands to Kafka keyed by `symbol`

The engine then handles those expiration commands through the same ordered path used for new orders.

### Persistence layer

PostgreSQL is the system of record.

It stores:

- `orders`
- `trades`
- `order_events`
- `idempotency_keys`
- `processed_commands`

The design intentionally skips snapshots in the first version. On restart, the engine rebuilds books from durable live orders instead.

## Matching Model

Each symbol has:

- a bid book
- an ask book

Each side should be modeled as:

- an ordered price index
- a FIFO queue per price level

Matching rules:

- only orders for the same symbol can match
- bids are prioritized by highest price, then earliest processed order
- asks are prioritized by lowest price, then earliest processed order
- a trade occurs when best bid is greater than or equal to best ask
- execution price is always the seller price
- partial fills are allowed
- remaining quantity stays active until filled or expired

Supporting in-memory indexes should include:

- `order_id -> order state`
- `order_id -> book location`

All price and quantity values should be stored as integers, never floating-point numbers.

## End-to-End Flows

### Order submission and matching flow

1. Broker sends `POST /orders` to `broker-api`.
2. The API validates the request and checks idempotency.
3. The API writes the order row and idempotency row in PostgreSQL.
4. The API publishes `SubmitOrder` directly to Kafka keyed by `symbol`.
5. The API returns `202 Accepted` with the public `order_id`.
6. The owning `matching-engine` consumer receives the command.
7. The engine ignores it if that command was already processed.
8. The engine loads or initializes the symbol book.
9. The engine applies price-time-priority matching.
10. The engine persists trades, events, updated order state, and processed-command markers.
11. `GET /orders/{order_id}` returns the latest persisted state from PostgreSQL.

### Order query flow

1. Broker requests `GET /orders/{order_id}`.
2. `broker-api` reads current order state and trade summary directly from PostgreSQL.
3. The system returns the persisted status and remaining quantity.

### Expiration flow

1. The embedded scheduler in `matching-engine` scans for due live orders.
2. It acquires a lease so only one scheduler instance emits commands.
3. It publishes `ExpireOrder` commands to Kafka keyed by `symbol`.
4. The owning engine consumer processes the command in symbol order.
5. The engine verifies the order is still open and actually expired.
6. The engine persists the expiration event and updated order state.

## Consistency Model

The system separates acceptance consistency from matching consistency.

### Synchronous guarantee

When `POST /orders` returns success:

- the order exists in PostgreSQL
- the `SubmitOrder` command has been accepted by Kafka
- the broker has a valid exchange order identifier
- the system can recover and continue processing after crash

### Asynchronous guarantee

Matching happens after acceptance through Kafka.

That means:

- `GET /orders/{order_id}` may briefly return `accepted`
- reads are eventually consistent relative to matching
- once processed, the order transitions into `open`, `partially_filled`, `filled`, or `expired`

This is an intentional tradeoff. It keeps the edge fast while preserving deterministic matching at scale.

### Simplification tradeoff

This version intentionally avoids an outbox to keep the architecture smaller.

That means the broker API performs a direct PostgreSQL plus Kafka write on submission.

This is simpler to build and explain, but it introduces a dual-write tradeoff that would need stronger mitigation in a more production-hardened design.

## Failure Handling and Recovery

### Broker API failure

If `broker-api` crashes before the acceptance transaction commits, the order is not accepted.

If it crashes after commit but before the client receives the response, retry safety comes from idempotency.

### Broker API publish failure

If the order is persisted in PostgreSQL but Kafka publish fails, the broker API should return an error and rely on broker retry plus idempotency.

This is one of the tradeoffs of removing the outbox from the design.

### Matching engine failure

If a `matching-engine` instance crashes:

- Kafka reassigns its partitions
- another instance takes ownership
- the new owner rebuilds books from live open orders in PostgreSQL
- command consumption resumes from Kafka

### Duplicate expiration commands

Even if the scheduler emits the same expiration command more than once:

- the engine checks whether the order is still open
- the engine checks whether it is truly expired
- processed-command deduplication prevents repeated state transitions

## Why This Design Scales

The main scalability advantages are:

- broker traffic scales independently from matching throughput
- `broker-api` can autoscale horizontally based on HTTP load
- `matching-engine` scales horizontally by distributing a fixed number of partitions across replicas
- symbols are distributed across Kafka partitions for parallelism
- one writer per symbol avoids global locking
- active books stay in memory on the hot path
- reads stay off engine internals

## Why This Design Is Simpler

Compared with the earlier version, this design removes complexity in three places:

- `broker-api` publishes directly to Kafka
- the expiration scheduler is embedded in `matching-engine`
- reads come directly from PostgreSQL instead of a separate query service

That keeps the important exchange invariants while reducing operational surface area.

## Evolution Path

If scale or team boundaries justify it later, this design can evolve by:

- introducing an outbox if stronger publish guarantees are required
- extracting `expiration-worker` into its own service
- introducing a dedicated read model
- adding snapshots for faster engine recovery
- isolating hot symbols onto dedicated partitions

Those changes preserve the same core invariants:

- single writer per symbol
- ordered command handling
- durable acceptance
- in-memory matching with durable outcomes
