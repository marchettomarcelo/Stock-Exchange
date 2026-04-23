# High-Level System Design

Note: `docs/engineering-case-marcelo.md` is deleted in the current working tree, so this document is based on the last committed version of that spec (`git show HEAD:docs/engineering-case-marcelo.md`) plus the current codebase.

## Overview

This repository implements a small exchange pipeline with two deployable services:

- `broker-api` accepts broker order submissions and order-status reads.
- `matching-engine` consumes exchange commands, owns live order books, and advances order state.

The runtime path is:

1. `broker-api` validates a `POST /orders` request.
2. It persists the accepted order and its idempotency record in PostgreSQL.
3. It publishes a `SubmitOrder` command to Kafka keyed by `symbol`.
4. `matching-engine` consumes that command, applies matching, and persists order updates, trades, events, and processed-command markers.
5. `broker-api` serves `GET /orders/:orderId` directly from PostgreSQL.

Order expiration follows the same ordered Kafka path. A scheduler in `matching-engine` scans PostgreSQL for due orders, acquires a PostgreSQL advisory lock so only one scanner is active, and publishes `ExpireOrder` commands keyed by `symbol`.

## Main Components

### `broker-api`

`broker-api` is the broker-facing HTTP service. It:

- exposes `POST /orders`
- exposes `GET /orders/:orderId`
- validates request bodies with the shared contract schemas
- enforces idempotency per `broker_id` and `idempotency_key`
- persists accepted orders before matching
- publishes exchange commands to Kafka
- remains stateless between requests

### Kafka

Kafka is the ordered command bus between acceptance and matching. The current command topic is configurable and defaults to `exchange.commands`.

The important rule is that every command is published with `symbol` as the message key. That gives the system:

- deterministic ordering per symbol
- partition-based parallelism across symbols
- a single active consumer owner for each partition within the consumer group

### `matching-engine`

`matching-engine` is the worker service. It:

- consumes `SubmitOrder` and `ExpireOrder`
- keeps in-memory `OrderBook` instances per symbol
- restores live books from PostgreSQL on demand
- writes back order-state changes, trades, and events
- records processed commands to make Kafka redelivery safe
- runs the expiration scan loop

### PostgreSQL

PostgreSQL is the durable system of record. The schema stores:

- `orders`
- `trades`
- `order_events`
- `idempotency_keys`
- `processed_commands`

`orders.resting_sequence` is used to rebuild the FIFO order of live resting orders after a restart.

## Exchange Rules

Each symbol has a bid side and an ask side. The live book keeps:

- an ordered price index per side
- FIFO order within each price level

The implemented matching rules are:

- only orders with the same symbol can match
- higher bid prices win on the buy side
- lower ask prices win on the sell side
- within the same price level, earlier resting orders win
- a trade happens when bid price is greater than or equal to ask price
- execution price is the seller price
- partial fills are allowed
- remaining quantity rests in the book only for `open` and `partially_filled` orders

Prices and quantities are stored as integers.

## Acceptance And Idempotency

The API accepts a request payload with:

- `broker_id`
- `owner_document`
- `side`
- `symbol`
- `price`
- `quantity`
- `valid_until`
- `idempotency_key`

The submission flow is intentionally split:

1. Parse and validate the request.
2. Check `idempotency_keys` by `(broker_id, idempotency_key)`.
3. Inside a PostgreSQL transaction, insert the accepted order plus an idempotency row with `publish_status = 'pending'`.
4. Publish `SubmitOrder` to Kafka.
5. Mark the idempotency row as `published`.
6. Return `202 Accepted` with `order_id`, `status: "accepted"`, and `accepted_at`.

If the database write succeeds but Kafka publish fails, the API returns an error. A retry with the same idempotency key resumes from the stored pending record instead of creating a second order.

## Runtime State Model

The status progression visible in PostgreSQL is:

- `accepted` right after durable API acceptance
- `open` once the engine places an unmatched order into the live book
- `partially_filled` after one or more fills with quantity remaining
- `filled` when remaining quantity reaches zero
- `expired` when the order expires before it is fully filled

Because matching is asynchronous, `GET /orders/:orderId` can briefly return `accepted` after a successful submission.

## Ordering, Recovery, And Expiration

The system relies on three ordering rules:

- Kafka preserves command order per symbol key.
- Only one consumer in the group actively owns a partition at a time.
- Resting orders are rebuilt from PostgreSQL in `resting_sequence` order.

Recovery is simple:

- if a `matching-engine` instance stops, Kafka reassigns its partitions
- another instance consumes those partitions
- symbol books are recreated lazily from `open` and `partially_filled` rows

Expiration uses the same ordered path as submissions:

1. the scheduler acquires a PostgreSQL advisory lock
2. it loads due orders in `accepted`, `open`, or `partially_filled`
3. it publishes `ExpireOrder` commands keyed by `symbol`
4. the owning consumer processes expiration in symbol order

That keeps all state transitions on the same command stream.

## Failure Handling

### Duplicate delivery

Kafka is treated as at-least-once. `matching-engine` records every processed command in `processed_commands` and skips duplicates safely.

### API crash before commit

If `broker-api` fails before the acceptance transaction commits, the order was not accepted.

### API crash after commit but before response

The order may already exist with a pending or published idempotency record. A broker retry with the same idempotency key is the recovery path.

### Engine crash

The in-memory books are disposable. Durable state in PostgreSQL plus Kafka partition reassignment is enough to resume processing.
