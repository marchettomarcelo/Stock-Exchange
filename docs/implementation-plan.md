# Implementation Plan

## Purpose

This document describes a practical build order for the exchange system defined in [high-level-system-design.md](/Users/marcelomarchetto/Desktop/decade/docs/high-level-system-design.md) and [codebase-organization.md](/Users/marcelomarchetto/Desktop/decade/docs/codebase-organization.md).

The goal is to move from an empty repository to a working system in small, verifiable steps. Each step below explains:

- what to build
- where the code should live
- how the pieces fit together
- what should be tested before moving on

The sequence matters. The later steps assume the earlier boundaries are already in place.

## Delivery Strategy

Build the system in this order:

1. repository scaffolding and developer tooling
2. shared contracts and core domain types
3. pure matching engine logic
4. PostgreSQL schema and repositories
5. Kafka producer and consumer adapters
6. `broker-api`
7. `matching-engine`
8. expiration scheduling
9. local infrastructure and containers
10. integration testing, observability, and hardening

This order keeps the risky parts isolated early:

- matching rules are validated before infrastructure is involved
- persistence is validated before runtime composition is added
- the API and engine are built against stable contracts

## Step 1: Scaffold The Monorepo

### Goal

Create a repository shape that makes application code, shared packages, database assets, and infrastructure easy to navigate.

### What to build

Create the top-level directories described in [codebase-organization.md](/Users/marcelomarchetto/Desktop/decade/docs/codebase-organization.md):

- `apps/broker-api`
- `apps/matching-engine`
- `packages/exchange-core`
- `packages/application`
- `packages/infrastructure`
- `packages/contracts`
- `packages/testing`
- `db/migrations`
- `db/seeds`
- `infra/docker`
- `infra/compose`

Add the workspace-level files:

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `eslint.config.mjs`
- `nest-cli.json`

### How to build it

Start by setting up the workspace manager and TypeScript project references. The repo should support:

- one shared dependency graph
- package-local builds
- app-local startup commands
- root-level lint and test commands

At this stage, keep package scripts simple:

- `build`
- `lint`
- `test`
- `test:watch`
- `dev`

Make sure every package and app has its own `package.json` and `tsconfig.json`, but inherit shared compiler settings from the root.

For NestJS apps, create a minimal `main.ts` and `app.module.ts` in both applications so the runtime shape exists early, even before the business logic is added.

### Exit criteria

Before moving on, the repository should support:

- installing dependencies from the root
- building every package without application logic yet
- running placeholder `broker-api` and `matching-engine` processes
- linting the workspace successfully

## Step 2: Define Shared Contracts And Domain Primitives

### Goal

Create the shared language of the system before implementing behavior.

### What to build

In `packages/contracts`, define:

- order request DTOs
- order response DTOs
- order status enums
- command payloads for `SubmitOrder` and `ExpireOrder`
- shared validation schemas

In `packages/exchange-core`, define the basic value objects and domain types:

- `OrderId`
- `BrokerId`
- `OwnerDocument`
- `Symbol`
- `OrderSide`
- `Price`
- `Quantity`
- `ValidUntil`
- `OrderStatus`

### How to build it

Start from the exercise requirements and normalize the wire format before building any handlers.

Important decisions to lock down now:

- price and quantity are integers
- timestamps are stored in UTC
- order status values are explicit and finite
- command payloads carry only the fields needed for engine processing

The API contract should include:

- broker identifier
- owner document number
- side
- symbol
- price
- quantity
- validity timestamp
- idempotency key

The `SubmitOrder` command should include enough information for the engine to process the order without looking back at the HTTP layer. It should not carry framework-specific shapes or transport metadata that only matter to the API.

This is also the point to decide naming conventions that must stay stable across the system:

- `order_id`
- `remaining_quantity`
- `valid_until`
- `accepted_at`
- `processed_at`

### Exit criteria

Before moving on, there should be:

- one canonical order submission schema
- one canonical order status response shape
- stable command payload types for Kafka
- unit tests for schema validation and serialization rules

## Step 3: Build The Pure Matching Engine

### Goal

Implement deterministic matching logic with no infrastructure dependencies.

### What to build

In `packages/exchange-core`, implement:

- an `OrderBook` aggregate per symbol
- bid-side and ask-side price indexes
- FIFO queues per price level
- order insertion, matching, reduction, and removal logic
- execution generation
- expiration checks

Suggested internal modules:

- `entities/order.ts`
- `entities/trade.ts`
- `book/order-book.ts`
- `book/price-level.ts`
- `matching/match-order.ts`
- `policies/execution-price.ts`
- `errors/*`

### How to build it

Implement the engine without PostgreSQL, Kafka, NestJS, or clocks from the outside world. The core should accept plain inputs and return plain outputs.

Recommended flow for `addOrder`:

1. reject the order if it is already expired at processing time
2. choose the opposite side of the book
3. repeatedly compare the incoming order with the best available price level
4. stop when price no longer crosses or the incoming order is fully filled
5. create trade records at the seller price
6. update remaining quantities on both sides
7. remove fully filled resting orders
8. insert any remaining quantity into the correct side of the book

The matching rules to preserve:

- bids prioritize higher prices first
- asks prioritize lower prices first
- within the same price, earlier processed orders win
- partial fills keep the remaining quantity active
- execution price is always the seller price

Do not couple the core engine to database identifiers beyond the stable domain identifiers it needs. The engine should be reusable in tests without starting any infrastructure.

### Tests to write

This step should have the densest unit coverage in the repository.

Write tests for:

- same-price full match
- price-gap match at seller price
- no-match scenario
- partial fill with remainder resting
- multiple resting orders at the same price level
- strict FIFO behavior inside one price level
- best-price priority across price levels
- expired order rejection
- duplicate order insertion prevention if the core tracks existing orders

Property-based tests are useful here. At minimum, prove:

- no trade quantity exceeds either order quantity
- total filled plus remaining equals original quantity
- no bid and ask remain crossed after matching finishes

### Exit criteria

Before moving on, `exchange-core` should be independently testable and produce deterministic results with no external services.

## Step 4: Design The Database Schema

### Goal

Create a persistence model that supports durable acceptance, matching outcomes, idempotency, and engine recovery.

### What to build

In `db/migrations`, create tables for:

- `orders`
- `trades`
- `order_events`
- `idempotency_keys`
- `processed_commands`

### How to build it

Model `orders` as the current state table. It should include enough fields to answer `GET /orders/{order_id}` and to rebuild live books on engine restart.

Suggested fields for `orders`:

- `order_id`
- `broker_id`
- `owner_document`
- `symbol`
- `side`
- `price`
- `original_quantity`
- `remaining_quantity`
- `status`
- `valid_until`
- `accepted_at`
- `last_updated_at`

Suggested fields for `trades`:

- `trade_id`
- `symbol`
- `buy_order_id`
- `sell_order_id`
- `price`
- `quantity`
- `executed_at`

Suggested fields for `order_events`:

- `event_id`
- `order_id`
- `event_type`
- `payload`
- `created_at`

Suggested fields for `idempotency_keys`:

- `idempotency_key`
- `broker_id`
- `order_id`
- `request_hash`
- `created_at`

Suggested fields for `processed_commands`:

- `command_id`
- `command_type`
- `symbol`
- `processed_at`

Index the access paths that the runtime will actually use:

- `orders(order_id)`
- `orders(symbol, status, valid_until)`
- `trades(buy_order_id)`
- `trades(sell_order_id)`
- `order_events(order_id, created_at)`
- `idempotency_keys(broker_id, idempotency_key)`
- `processed_commands(command_id)`

`orders` should support reconstruction of open books by querying live orders for a symbol or partition-owned symbol set. That means the open-order statuses must be queryable efficiently.

### Exit criteria

Before moving on, there should be:

- repeatable migrations
- a local way to create the schema from scratch
- integration tests proving inserts, updates, and uniqueness constraints work as expected

## Step 5: Build Infrastructure Adapters

### Goal

Create concrete adapters for PostgreSQL, Kafka, configuration, time, and locking.

### What to build

In `packages/infrastructure`, implement:

- database connection management
- repository implementations
- transaction helpers
- Kafka producer wrapper
- Kafka consumer wrapper
- lease or advisory-lock service
- clock abstraction
- configuration module
- structured logging

### How to build it

Start with interfaces in `packages/application`, then implement them here.

Recommended application-facing interfaces:

- `OrderRepository`
- `TradeRepository`
- `OrderEventRepository`
- `IdempotencyRepository`
- `ProcessedCommandRepository`
- `CommandPublisher`
- `CommandConsumer`
- `LeaseManager`
- `Clock`

The repository layer should expose operations shaped around use cases, not generic CRUD abstractions. For example:

- `createAcceptedOrder(...)`
- `findOrderById(...)`
- `findOpenOrdersForRecovery(...)`
- `appendTradeBatch(...)`
- `markCommandProcessed(...)`
- `findExistingIdempotentSubmission(...)`

For Kafka, create a thin adapter that hides topic names, serialization, and partition-key handling from the apps. The application layer should ask to publish a typed command, not manipulate a low-level Kafka producer directly.

For locking, prefer one clear strategy and use it consistently. PostgreSQL advisory locks are enough for the expiration scheduler in this version.

### Exit criteria

Before moving on, there should be:

- repository integration tests against PostgreSQL
- Kafka adapter tests for publish and consume flow
- one working advisory-lock or lease mechanism
- application-facing interfaces with no framework leakage

## Step 6: Implement The Application Use Cases

### Goal

Build orchestration logic that coordinates repositories, publishers, and the pure domain engine.

### What to build

In `packages/application`, implement:

- `SubmitOrder`
- `GetOrderStatus`
- `ProcessOrderCommand`
- `ProcessExpireCommand`
- `ScanForExpiredOrders`

### How to build it

#### `SubmitOrder`

This use case should:

1. validate and normalize the incoming request
2. check whether the broker and idempotency key already map to a known submission
3. if yes, return the existing result
4. if not, create a new `order_id`
5. write the accepted order and idempotency record in one transaction
6. publish `SubmitOrder` to Kafka keyed by `symbol`
7. return the accepted response

This step is where the dual-write tradeoff lives. The code should make that path obvious and contain the failure behavior explicitly.

#### `GetOrderStatus`

This use case should read from PostgreSQL only. It should not inspect in-memory engine state.

Return:

- current order status
- original quantity
- remaining quantity
- optional trade summary if included in the response shape

#### `ProcessOrderCommand`

This use case should:

1. check whether the command was already processed
2. load or initialize the symbol book
3. apply the order to the in-memory book
4. persist trades, events, updated order state, and processed-command markers in one transaction

The transaction boundary matters here. The engine should not emit half-applied results.

#### `ProcessExpireCommand`

This use case should:

1. check command deduplication
2. verify the order still exists, is still open, and is truly expired
3. remove it from the in-memory book if present
4. persist the expiration event, updated order state, and processed-command marker

#### `ScanForExpiredOrders`

This use case should:

1. attempt to acquire the scheduler lease
2. query due open orders
3. publish `ExpireOrder` commands keyed by `symbol`
4. release or renew the lease according to the chosen scheduler model

### Exit criteria

Before moving on, the application package should be testable with fakes for repositories, publisher, lock manager, and clock.

## Step 7: Build `broker-api`

### Goal

Expose the broker-facing HTTP surface on top of the application use cases.

### What to build

In `apps/broker-api`, implement:

- `POST /orders`
- `GET /orders/{order_id}`
- request validation
- response mapping
- health endpoints
- dependency wiring for repositories and Kafka publishing

### How to build it

Keep the HTTP layer thin. Controllers should translate requests into application commands and map results back to transport DTOs.

Recommended module split:

- `orders/orders.controller.ts`
- `orders/orders.module.ts`
- `orders/orders.service.ts` only if needed for wiring
- `publishing/publishing.module.ts`
- `health/health.controller.ts`

`POST /orders` should:

- validate the payload
- extract the idempotency key
- call `SubmitOrder`
- return `202 Accepted`

`GET /orders/{order_id}` should:

- validate the identifier format
- call `GetOrderStatus`
- return the persisted state from PostgreSQL

Add request logging, but do not let logging code leak into the application layer.

### Tests to write

Write:

- controller tests for validation and status codes
- e2e tests for submission and query
- e2e tests for idempotent retries returning the same order

### Exit criteria

Before moving on, a broker should be able to submit an order and query it successfully, even if the engine has not processed it yet.

## Step 8: Build `matching-engine`

### Goal

Create the worker that consumes symbol-keyed commands, owns live books, and persists matching results.

### What to build

In `apps/matching-engine`, implement:

- Kafka consumer startup
- partition assignment handling
- in-memory symbol book registry
- command dispatch to `ProcessOrderCommand` and `ProcessExpireCommand`
- health endpoints

### How to build it

The key runtime concept is partition ownership.

When a consumer instance owns a Kafka partition, it becomes responsible for the symbols mapped to that partition. Since symbols arrive keyed by `symbol`, Kafka preserves the ordering needed for deterministic processing.

Add a book manager component that:

- keeps a map of `symbol -> OrderBook`
- lazily loads books when a symbol is first seen
- clears or rebuilds books on rebalance events if needed

For recovery, when a symbol is first handled after startup, load the currently open orders for that symbol from PostgreSQL and replay them into a new in-memory `OrderBook`.

That recovery flow should:

1. query open orders ordered by their engine-relevant processing order
2. rebuild the book in memory
3. cache the result for future commands

Do not let multiple local threads mutate the same symbol book concurrently. The Kafka partition model should be the only writer path.

### Tests to write

Write:

- integration tests for command consumption
- recovery tests that rebuild books from persisted open orders
- duplicate command tests
- rebalance-aware tests if the consumer library makes them practical

### Exit criteria

Before moving on, the engine should be able to consume a submitted order, update the book, persist results, and survive a restart by rebuilding from PostgreSQL.

## Step 9: Add Expiration Scheduling

### Goal

Expire orders through the same ordered command path used for new submissions.

### What to build

In `apps/matching-engine` and `packages/application`, implement:

- a periodic scheduler loop
- lease acquisition
- due-order scanning
- `ExpireOrder` command publication

### How to build it

Run the scheduler inside `matching-engine`, but make sure only one instance is active at a time.

A simple model is:

1. wake up on a fixed interval
2. try to acquire an advisory lock
3. if the lock is held, scan for due open orders
4. publish one `ExpireOrder` command per order keyed by `symbol`
5. sleep until the next cycle

The scheduler must not directly update `orders` to `expired`. It should only enqueue the command. The actual state transition still belongs to the same engine processing path that owns submissions and fills.

This keeps ordering correct in edge cases such as:

- an order becoming due while a new crossing order is already queued
- duplicate expiration scans
- engine restarts during expiration processing

### Tests to write

Write:

- scheduler tests for lease exclusivity
- due-order scan tests
- duplicate expiration publication tolerance tests
- end-to-end expiration tests from accepted order to expired state

### Exit criteria

Before moving on, expired orders should transition through the same command-processing path as every other live-book mutation.

## Step 10: Package The Local Runtime

### Goal

Make the system reproducible for local development and evaluation.

### What to build

In `infra/docker` and `infra/compose`, add:

- `Dockerfile.broker-api`
- `Dockerfile.matching-engine`
- `docker-compose.yml` for PostgreSQL, Kafka, and both apps

### How to build it

The local stack should make it possible to:

- start PostgreSQL
- start Kafka
- apply migrations
- run `broker-api`
- run `matching-engine`
- exercise the end-to-end flows from the exercise prompt

Keep the compose file small. It only needs the exchange services plus the dependencies they require to run locally.

Document the expected startup sequence:

1. install dependencies
2. start infrastructure
3. apply migrations
4. start `broker-api`
5. start `matching-engine`
6. submit orders and query status

### Exit criteria

Before moving on, a fresh clone should be able to boot the stack with documented commands and reproduce a simple trade.

## Step 11: Add End-To-End Tests

### Goal

Verify the whole system behaves correctly through the public interfaces.

### What to build

Create end-to-end tests that boot the relevant services with PostgreSQL and Kafka and exercise real workflows.

### How to build it

Cover these scenarios first:

- submit one bid and one ask at the same price and verify fill
- submit crossing prices and verify seller-price execution
- submit non-crossing prices and verify both orders remain open
- submit partial-fill scenarios and verify remaining quantity
- submit duplicate API requests and verify idempotent behavior
- restart the engine and verify recovery from persisted open orders
- let an order expire and verify the final state is `expired`

Prefer end-to-end tests that assert on persisted state and public API responses rather than internal implementation details.

### Exit criteria

Before moving on, the system should have automated proof that the core exchange rules hold across process boundaries.

## Step 12: Add Observability And Operational Safeguards

### Goal

Make the system diagnosable and safe to operate.

### What to build

Add:

- structured logs
- request and command correlation identifiers
- health and readiness checks
- basic metrics
- startup validation for required configuration

### How to build it

Logs should make it possible to trace:

- order acceptance
- command publication
- command consumption
- matching outcomes
- expiration activity
- recovery and rebalance behavior

Metrics should include at least:

- accepted orders count
- published commands count
- processed commands count
- duplicate command count
- trade count
- expiration count
- command-processing latency

Readiness should fail when critical dependencies are unavailable. For example:

- `broker-api` should fail readiness if PostgreSQL or Kafka is unavailable
- `matching-engine` should fail readiness if PostgreSQL or Kafka is unavailable

### Exit criteria

Before considering the system complete, operators should be able to tell:

- whether the services are alive
- whether they can process traffic
- whether commands are flowing
- whether the engine is keeping up

## Recommended Milestone Breakdown

If the work needs to be split across milestones, use this order:

### Milestone 1

- scaffold the repo
- define contracts
- build `exchange-core`
- write core matching tests

### Milestone 2

- create PostgreSQL schema
- implement repositories
- build application use cases
- verify idempotent submission and order reads

### Milestone 3

- implement Kafka publishing and consumption
- build `broker-api`
- build `matching-engine`
- verify end-to-end matching

### Milestone 4

- add expiration scheduling
- add recovery tests
- add containers and compose
- add operational metrics and health checks

## Non-Negotiable Rules During Implementation

These constraints should not be relaxed during the build:

- use integers for money and quantity
- preserve price-time priority
- keep one active writer per symbol
- treat Kafka delivery as at-least-once
- make engine command handling idempotent
- persist accepted orders before returning success
- serve reads from PostgreSQL, not live engine memory
- route expiration through the same command path as submission

If one of these rules becomes difficult to preserve, treat that as a design issue to resolve, not as something to patch over in implementation.
