# Codebase Organization Proposal

## Purpose

This document defines how the codebase should be organized to implement the lean scalable exchange architecture described in [high-level-system-design.md](/Users/marcelomarchetto/Desktop/decade/docs/high-level-system-design.md).

The main simplifications compared with the earlier proposal are:

- two deployable applications instead of four
- direct publish from `broker-api` to Kafka
- no separate expiration worker
- no separate query service
- a smaller shared-library surface

The goal is to keep the architecture scalable without turning the first build into an unnecessarily fragmented distributed system.

## Target Architecture

The target implementation stack is:

- NestJS for application composition and transport adapters
- TypeScript for all application and domain code
- PostgreSQL as the system of record
- Kafka as the ordered command bus
- a monorepo with two deployable applications

The two deployable applications are:

- `broker-api`
- `matching-engine`

## Architectural Direction

The system should be implemented as a small service-oriented monorepo.

### `broker-api`

This application owns:

- HTTP endpoints
- validation
- idempotent order acceptance
- direct Kafka publish for `SubmitOrder`
- direct order-status reads from PostgreSQL

### `matching-engine`

This application owns:

- Kafka command consumption
- partition ownership
- in-memory order books
- deterministic matching
- persistence of trades and order state
- processed-command deduplication
- an embedded expiration scheduler

This keeps the physical architecture small while preserving the correct scalability boundary:

- `broker-api` scales by HTTP load and can autoscale horizontally
- `matching-engine` scales by partition ownership up to a fixed partition count

## Recommended Repository Layout

```text
.
├── apps
│   ├── broker-api
│   │   ├── src
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── orders
│   │   │   ├── publishing
│   │   │   └── health
│   │   └── test
│   └── matching-engine
│       ├── src
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── engine
│       │   ├── expiration
│       │   └── health
│       └── test
├── packages
│   ├── exchange-core
│   ├── application
│   ├── infrastructure
│   ├── contracts
│   └── testing
├── db
│   ├── migrations
│   └── seeds
├── infra
│   ├── docker
│   │   ├── Dockerfile.broker-api
│   │   └── Dockerfile.matching-engine
│   └── compose
│       └── docker-compose.yml
├── docs
├── package.json
├── pnpm-workspace.yaml
├── nest-cli.json
├── tsconfig.base.json
└── eslint.config.mjs
```

## Why This Layout

### `apps/`

`apps/` should contain deployable entrypoints only.

- `broker-api` is the broker-facing HTTP service
- `matching-engine` is the internal worker service

### `packages/`

`packages/` should contain shared code with clear responsibilities.

- `exchange-core` keeps the matching logic pure
- `application` holds use cases and orchestration
- `infrastructure` hides PostgreSQL, Kafka, config, and logging details
- `contracts` defines HTTP and message payloads
- `testing` centralizes fixtures and helpers

### `infra/`

`infra/` should stay small.

- Dockerfiles for the two applications
- a local `docker-compose.yml` for PostgreSQL, Kafka, and the apps

Kubernetes manifests can be added later if needed, but they should not drive the initial repo structure.

## Package Responsibilities

### `packages/exchange-core`

This package should contain the pure exchange engine with no NestJS or infrastructure dependencies.

Contents:

- `OrderBook`
- bid-side and ask-side structures
- matching policies
- execution generation
- expiration checks
- value objects and domain errors

Rules:

- no SQL
- no Kafka client code
- no HTTP code
- use integers for price and quantity

### `packages/application`

This package should contain use cases and orchestration logic shared by the two apps.

Contents:

- `SubmitOrder`
- `GetOrderStatus`
- direct publish orchestration
- `ProcessOrderCommand`
- `ProcessExpireCommand`
- expiration scan orchestration
- idempotency handling
- processed-command deduplication rules

This package should depend on interfaces, not concrete drivers.

### `packages/infrastructure`

This package should contain adapters for external systems.

Contents:

- PostgreSQL repositories
- transaction helpers
- Kafka producer and consumer adapters
- lease or advisory-lock helpers
- config parsing
- logger and metrics wiring

Suggested tables:

- `orders`
- `trades`
- `order_events`
- `idempotency_keys`
- `processed_commands`

### `packages/contracts`

This package should define transport and integration contracts.

Contents:

- HTTP request and response schemas
- `SubmitOrder` command payload
- `ExpireOrder` command payload
- query DTOs

### `packages/testing`

This package should centralize test helpers.

Contents:

- order fixture builders
- fake clock
- PostgreSQL integration helpers
- Kafka integration helpers
- deterministic engine assertions

## Application Composition

### `apps/broker-api`

This app should compose:

1. `contracts`
2. `application`
3. `infrastructure`

Key responsibilities:

- expose `POST /orders`
- expose `GET /orders/:orderId`
- validate and normalize requests
- persist accepted orders in PostgreSQL
- publish `SubmitOrder` directly to Kafka
- return persisted order status to brokers

This app must remain stateless between HTTP requests.

### `apps/matching-engine`

This app should compose:

1. `exchange-core`
2. `application`
3. `infrastructure`
4. `contracts`

Key responsibilities:

- consume Kafka partitions
- own symbol books for assigned partitions
- apply deterministic matching rules
- persist trades, events, and updated order state
- record processed commands for idempotency
- run the embedded expiration scheduler

This app is not externally reachable by brokers.

## Dependency Rules

The codebase should follow these dependency rules:

- `apps/*` may depend on `packages/*`
- `exchange-core` must not depend on NestJS, Kafka, or SQL
- `application` may depend on `exchange-core` and `contracts`
- `application` should interact with storage and messaging through interfaces
- `infrastructure` may depend on `application`, `contracts`, and environment libraries
- `contracts` must not depend on NestJS infrastructure
- `testing` may depend on any package needed for test support

The most important boundary is still this:

- the matching engine core must never know about HTTP, Kafka client APIs, or PostgreSQL

## Persistence Strategy

The database should be organized for durable acceptance, matching recovery, and direct reads.

Recommended choices:

- PostgreSQL as the primary system of record
- writes for accepted orders and idempotency records
- transactional writes for trade persistence and order-state updates
- direct reads for `GET /orders/:orderId`
- indexes for `order_id`, `symbol`, `status`, and `valid_until`

Storage responsibilities:

- `orders` stores current order state
- `trades` stores every execution
- `order_events` stores the lifecycle trail
- `idempotency_keys` protects broker retries
- `processed_commands` prevents duplicate engine effects

The initial version should not introduce snapshots. Engine recovery should rebuild books from currently open orders.

## Messaging Strategy

Kafka should be used narrowly and intentionally.

Responsibilities:

- carry `SubmitOrder` and `ExpireOrder` commands
- preserve per-symbol ordering
- allow horizontal engine scale by partition ownership

Important rules:

- always key commands by `symbol`
- assume at-least-once delivery
- make engine command handlers idempotent
- keep command payloads minimal and stable
- use a fixed partition count to define engine-tier parallelism

That fixed partition count sets the upper bound of active matching parallelism:

- each partition has only one active owner at a time
- one symbol always maps to one partition
- adding engine replicas beyond the partition count improves availability, not throughput

## Runtime Model

### Broker API runtime

- run as a stateless deployment
- scale horizontally behind a load balancer or HPA
- publish `SubmitOrder` directly to Kafka
- read from PostgreSQL directly

### Matching engine runtime

- run as a deployment with multiple replicas
- consume Kafka partitions via a consumer group
- let Kafka assign partition ownership
- scale only up to the configured partition count
- run exactly one expiration scheduler at a time using a lease or advisory lock

This is why a `Deployment` is enough here. Stable pod identity is less important than consumer-group ownership.

## Testing Strategy

Recommended stack:

- Vitest for unit and integration tests
- Nest testing utilities for app bootstrapping
- Supertest for HTTP e2e coverage
- Testcontainers for PostgreSQL and Kafka-backed tests
- `fast-check` for matching invariants

Minimum test suites:

- price-time priority
- seller-price execution
- partial fills
- expired order rejection
- idempotent API retries
- duplicate command handling
- per-symbol ordered processing
- engine recovery by rebuilding from open orders

## Implementation Notes

A few constraints should be treated as non-negotiable:

- money and quantity values must be integers
- acceptance must be durable before returning success
- matching must remain single-writer per symbol
- reads must not inspect live in-memory books
- expiration must use the same ordered path as submission
- duplicate command delivery must be safe
- the API tier and engine tier must have independent scaling policies

This design intentionally accepts a direct PostgreSQL plus Kafka write on submission.

That keeps the codebase smaller, but it introduces a dual-write tradeoff that should be discussed explicitly.

## Recommended First Milestone

The first implementation slice should create:

1. monorepo scaffolding with `apps/broker-api` and `apps/matching-engine`
2. a pure `exchange-core` package with deterministic matching tests
3. PostgreSQL persistence for orders, trades, events, idempotency, and processed commands
4. Kafka setup with symbol-keyed commands
5. `POST /orders` and `GET /orders/:orderId` in `broker-api`
6. command consumption and matching in `matching-engine`
7. direct publish from `broker-api` and the embedded expiration scheduler
8. Dockerfiles and local compose infrastructure

That gives a scalable design with fewer moving parts and a codebase shape that is practical to implement.
