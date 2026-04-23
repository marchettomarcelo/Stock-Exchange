# High-Level System Design

## Overview

This system is a small stock exchange designed to receive orders from brokers, match compatible buy and sell orders, and let brokers query the status of an order later.

At a high level, it is built around four pieces:

- `broker-api` receives broker requests
- Kafka carries ordered commands to the matching tier
- `matching-engine` owns live order books and performs matching
- PostgreSQL stores durable order, trade, and event data

The design is intentionally simple, but it keeps the exchange guarantees that matter most:

- price-time-priority matching
- one active writer per symbol
- durable order acceptance
- horizontal scale across symbols
- safe recovery after crashes or duplicate delivery

## What The System Does

The exchange supports the following core behavior:

- brokers submit buy and sell orders
- the system assigns an exchange order identifier
- brokers query order status later using that identifier
- orders match only when symbol, price, and validity allow it
- partial fills are supported
- when bid and ask cross, the trade executes at the seller price

The order submission payload includes:

- `broker_id`
- `owner_document`
- `side`
- `symbol`
- `price`
- `quantity`
- `valid_until`
- `idempotency_key`

This design does not cover:

- brokerage balances or account management
- custody or settlement
- KYC, AML, or compliance workflows
- advanced market mechanisms such as auctions or market orders
- multi-region active-active deployment

## Core Principles

### One active writer per symbol

Each symbol is matched by exactly one active engine owner at a time.

That keeps matching deterministic and avoids concurrent writes inside the same order book.

### Matching order comes from the engine path

Broker timestamps are not used to decide fill priority.

The authoritative order is the order in which the engine processes commands for a symbol from Kafka. That is the sequence that defines time priority.

### Order acceptance must be durable

An order is considered accepted only after:

- the order is written to PostgreSQL
- the matching command is accepted by Kafka

This lets the API acknowledge receipt before matching finishes, without risking silent loss.

### Hot state in memory, durable state in PostgreSQL

The matching engine keeps active order books in memory for speed.

PostgreSQL remains the system of record for:

- current order state
- trades
- immutable order events
- idempotency records
- processed command markers

### Expiration follows the same ordered path as submission

Expired orders are not removed by directly mutating live books.

Instead, the system emits expiration commands into the same symbol-keyed command stream used for new orders. That preserves ordering and keeps all live state changes inside the engine.

## Main Components

### `broker-api`

This service is the broker-facing entrypoint.

Its responsibilities are:

- expose `POST /orders`
- expose `GET /orders/{order_id}`
- validate and normalize requests
- enforce idempotency for retries
- persist accepted orders in PostgreSQL
- publish `SubmitOrder` commands to Kafka keyed by `symbol`
- serve reads directly from PostgreSQL

`broker-api` is stateless between requests, so it can scale horizontally behind a load balancer.

### Kafka command bus

Kafka is the ordered command path between the API and the engine.

Its role is to:

- preserve ordering per symbol
- decouple broker traffic from matching throughput
- distribute symbols across partitions
- define the maximum active parallelism of the engine tier

Every command is keyed by `symbol`, including:

- `SubmitOrder`
- `ExpireOrder`

One symbol always maps to one Kafka partition, and each partition has only one active consumer owner at a time.

### `matching-engine`

This service performs the actual exchange logic.

Its responsibilities are:

- consume commands from Kafka
- own in-memory books for the partitions assigned to it
- apply deterministic price-time-priority matching
- persist trades, events, and updated order state
- deduplicate repeated command delivery safely
- rebuild books after restart
- run the expiration scheduler

`matching-engine` is horizontally scalable, but only up to the configured Kafka partition count.

### PostgreSQL

PostgreSQL is the durable source of truth.

It stores:

- `orders`
- `trades`
- `order_events`
- `idempotency_keys`
- `processed_commands`

The engine rebuilds live books from durable open-order state after restart instead of relying on snapshots in the first version.

## Matching Model

Each symbol has two sides:

- a bid book
- an ask book

Each side is organized as:

- an ordered price index
- a FIFO queue for each price level

The matching rules are:

- only orders for the same symbol can match
- best bid has highest priority on the buy side
- best ask has highest priority on the sell side
- within the same price level, earlier processed orders win
- a trade happens when best bid is greater than or equal to best ask
- execution price is always the seller price
- partial fills are allowed
- remaining quantity stays open until filled or expired

All prices and quantities should be stored as integers, never floating-point numbers.

## End-To-End Flows

### Order submission

1. A broker sends `POST /orders` to `broker-api`.
2. The API validates the request and checks the idempotency key.
3. The API writes the accepted order and idempotency record to PostgreSQL.
4. The API publishes `SubmitOrder` to Kafka using `symbol` as the message key.
5. The API returns `202 Accepted` with the exchange `order_id`.

### Order matching

1. The owning `matching-engine` consumer receives the command.
2. The engine ignores it if that command was already processed.
3. The engine loads or initializes the symbol book.
4. The engine applies price-time-priority matching.
5. The engine writes trades, events, updated order state, and processed-command markers to PostgreSQL.
6. Later reads return the latest persisted state.

### Order status query

1. A broker calls `GET /orders/{order_id}`.
2. `broker-api` reads the current order state from PostgreSQL.
3. The API returns the persisted status and remaining quantity.

### Order expiration

1. A scheduler inside `matching-engine` scans PostgreSQL for due open orders.
2. One scheduler instance becomes active using a lease or advisory lock.
3. It publishes `ExpireOrder` commands to Kafka keyed by `symbol`.
4. The owning engine consumer processes those commands in symbol order.
5. The engine verifies the order is still open and truly expired.
6. The engine persists the expiration event and updated order state.

## Consistency Model

The system separates acceptance from matching.

### When submission succeeds

If `POST /orders` returns success, the following are true:

- the order exists in PostgreSQL
- Kafka accepted the `SubmitOrder` command
- the broker has a valid exchange `order_id`

Matching may still happen later.

### What brokers see immediately after submission

Because matching is asynchronous:

- `GET /orders/{order_id}` may briefly show `accepted`
- reads are eventually consistent relative to matching
- later states include `open`, `partially_filled`, `filled`, or `expired`

This keeps the write path fast while preserving deterministic matching.

## Failure Handling And Recovery

### API failure before commit

If `broker-api` crashes before the acceptance transaction commits, the order was never accepted.

### API failure after commit

If the API commits but the broker does not receive the response, retry safety depends on idempotency.

### Kafka publish failure during submission

If PostgreSQL write succeeds but Kafka publish fails, the API should return an error and rely on broker retry plus idempotency.

This is the main tradeoff of using a direct database write plus direct Kafka publish instead of an outbox.

### Engine failure

If a `matching-engine` instance crashes:

- Kafka reassigns its partitions
- another engine instance becomes the owner
- the new owner rebuilds books from open orders in PostgreSQL
- command consumption resumes

### Duplicate command delivery

Kafka should be treated as at-least-once delivery.

The engine must make command processing idempotent by recording which commands have already been applied.

## Scaling Model

The two services scale differently.

### API tier

- scales with HTTP traffic
- remains stateless
- can autoscale freely

### Matching tier

- scales by Kafka partition ownership
- can only process as many partitions as exist
- gains availability from extra replicas beyond active partition count, not more throughput

This is the key system boundary: broker traffic and matching throughput scale independently.
