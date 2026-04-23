# Codebase Organization

## Overview

This project is easiest to build and maintain as a small monorepo with two deployable applications and a small set of shared packages.

The goal of this structure is straightforward:

- keep deployable services easy to find
- keep matching logic isolated from transport and storage code
- make shared contracts explicit
- let the API tier and engine tier evolve independently without duplicating core logic

The main applications are:

- `broker-api`
- `matching-engine`

The shared packages support those two applications without turning the repository into a large framework.

## Repository Shape

The intended layout is:

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

At a glance:

- `apps/` contains deployable entrypoints
- `packages/` contains shared code with clear boundaries
- `db/` contains schema migrations and seeds
- `infra/` contains local and container runtime setup
- `docs/` contains design and onboarding material

## Applications

### `apps/broker-api`

This is the broker-facing HTTP service.

It should own:

- request validation
- idempotent order submission
- PostgreSQL writes for accepted orders
- Kafka publish for `SubmitOrder`
- direct reads for `GET /orders/{order_id}`
- health and readiness endpoints

This app should stay stateless between requests.

### `apps/matching-engine`

This is the internal worker that owns live matching.

It should own:

- Kafka command consumption
- partition ownership
- in-memory order books
- deterministic matching
- trade and order-state persistence
- processed-command deduplication
- the expiration scheduler
- health and readiness endpoints

This app is stateful at runtime because it owns live books in memory, but that state is rebuilt from durable data after restart.

## Shared Packages

### `packages/exchange-core`

This package contains the pure exchange engine.

It should include:

- `OrderBook`
- bid-side and ask-side structures
- matching policies
- execution generation
- expiration checks
- value objects
- domain errors

Rules for this package:

- no NestJS dependencies
- no SQL or repository code
- no Kafka client code
- no HTTP concerns
- use integers for price and quantity

If someone wants to understand the matching algorithm, this is the first package they should read.

### `packages/application`

This package contains use cases and orchestration that sit between the pure domain and the adapters.

It should include:

- `SubmitOrder`
- `GetOrderStatus`
- `ProcessOrderCommand`
- `ProcessExpireCommand`
- expiration scan orchestration
- idempotency rules
- processed-command deduplication rules

This package should depend on interfaces rather than concrete drivers.

### `packages/infrastructure`

This package contains adapters for external systems.

It should include:

- PostgreSQL repositories
- transaction helpers
- Kafka producer and consumer adapters
- lease or advisory-lock helpers
- configuration loading
- logger wiring
- metrics wiring

This is the package that knows how the system talks to PostgreSQL and Kafka.

### `packages/contracts`

This package defines the messages and schemas shared across boundaries.

It should include:

- HTTP request and response schemas
- `SubmitOrder` command payloads
- `ExpireOrder` command payloads
- query DTOs
- shared enums and status shapes

This package should stay small and stable because it defines the system's external and internal contracts.

### `packages/testing`

This package centralizes reusable test support.

It should include:

- order fixture builders
- fake clock utilities
- PostgreSQL integration helpers
- Kafka integration helpers
- deterministic engine assertions

This keeps tests consistent without spreading custom helpers across every app.

## Dependency Direction

The most important dependency rule is simple:

- the matching core must not know about HTTP, Kafka client APIs, or PostgreSQL

The rest of the dependency direction should follow these rules:

- `apps/*` may depend on `packages/*`
- `exchange-core` must not depend on the other packages
- `application` may depend on `exchange-core` and `contracts`
- `application` should talk to storage and messaging through interfaces
- `infrastructure` may depend on `application` and `contracts`
- `contracts` should not depend on framework-specific infrastructure
- `testing` may depend on any package needed for test support

These boundaries make it possible to test matching behavior in isolation and replace adapters without rewriting domain logic.

## Persistence Layout

The database exists to support durable order acceptance, matching recovery, and broker-facing reads.

The main tables are:

- `orders`
- `trades`
- `order_events`
- `idempotency_keys`
- `processed_commands`

Their responsibilities are:

- `orders` stores the current state of each order
- `trades` stores every execution
- `order_events` stores the order lifecycle trail
- `idempotency_keys` protects broker retries
- `processed_commands` prevents duplicate engine side effects

Direct reads for `GET /orders/{order_id}` should come from PostgreSQL rather than from live engine memory.

## Messaging Layout

Kafka is used narrowly as the ordered command bus between the API and matching engine.

The main rules are:

- publish `SubmitOrder` and `ExpireOrder`
- always key messages by `symbol`
- assume at-least-once delivery
- make engine handlers idempotent
- keep payloads minimal and stable
- use a fixed partition count to define engine parallelism

That partition count is an architectural setting, not just a Kafka detail. It decides how much matching work can run in parallel.

## Runtime Model

### `broker-api` runtime

- runs as a stateless deployment
- scales with HTTP traffic
- reads from PostgreSQL directly
- publishes commands to Kafka directly

### `matching-engine` runtime

- runs as a worker deployment
- consumes Kafka partitions in a consumer group
- owns symbol books for its assigned partitions
- scales only up to the Kafka partition count
- runs exactly one active expiration scheduler using a lease or advisory lock

This split keeps the operational model easy to reason about: the API handles ingress and reads, while the engine handles ordered state transitions.

## Testing Strategy

The repository should support four levels of testing.

### Unit tests

Focus on `exchange-core`:

- price-time priority
- seller-price execution
- partial fills
- expiration checks

### Application tests

Focus on orchestration:

- idempotent submission
- duplicate command handling
- order-state transitions

### Integration tests

Focus on adapters:

- PostgreSQL persistence
- Kafka publish and consume behavior
- engine recovery from durable open orders

### End-to-end tests

Focus on the broker-facing behavior:

- `POST /orders`
- `GET /orders/{order_id}`
- asynchronous transition from accepted to matched or expired

Recommended tooling:

- Vitest
- Nest testing utilities
- Supertest
- Testcontainers
- `fast-check` for matching invariants

## How To Read The Codebase

For a first pass through the repository, this order works well:

1. Read `docs/high-level-system-design.md` to understand the runtime model.
2. Read `packages/contracts` to see the system inputs and outputs.
3. Read `packages/exchange-core` to understand matching behavior.
4. Read `packages/application` to see how commands and use cases are orchestrated.
5. Read `apps/broker-api` and `apps/matching-engine` to see how the system is composed at runtime.
6. Read `packages/infrastructure` last to understand PostgreSQL, Kafka, and operational wiring.

That path moves from system behavior to implementation details without mixing concerns too early.
