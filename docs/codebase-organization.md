# Codebase Organization

## Overview

This repository is a TypeScript monorepo for the exchange system described in [`high-level-system-design.md`](./high-level-system-design.md).

The main source of truth is under `apps/*/src`, `packages/*/src`, `db/`, and `infra/`. The repo also contains generated `dist/` output and `tsconfig.tsbuildinfo` files for the workspace packages and apps.

## Top-Level Layout

```text
.
├── apps/
│   ├── broker-api/
│   └── matching-engine/
├── packages/
│   ├── application/
│   ├── contracts/
│   ├── exchange-core/
│   ├── infrastructure/
│   └── testing/
├── db/
├── docs/
└── infra/
```

At a glance:

- `apps/` contains the two deployable NestJS services.
- `packages/` contains shared contracts, domain logic, use cases, adapters, and test helpers.
- `db/` contains the PostgreSQL schema migration and database scripts.
- `infra/` contains local runtime assets such as Dockerfiles, Compose, and HAProxy config.

## Applications

### `apps/broker-api`

This is the broker-facing HTTP service.

Current source layout:

- `src/main.ts`: Nest bootstrap
- `src/app.module.ts`: top-level Nest module
- `src/orders/`: controller and module for `POST /orders` and `GET /orders/:orderId`
- `src/health/`: health endpoint
- `src/runtime/`: provider tokens, runtime factories, and shutdown handling
- `src/publishing/`: currently just an empty placeholder module

The runtime providers in `src/runtime/runtime.providers.ts` compose:

- config loading from `@decade/infrastructure`
- JSON logging, clock, request hashing, and ID generation
- PostgreSQL pool creation
- Kafka client and publisher creation
- `SubmitOrder` and `GetOrderStatus` use cases

### `apps/matching-engine`

This is the worker service that consumes exchange commands and advances order state.

Current source layout:

- `src/main.ts`: Nest bootstrap
- `src/app.module.ts`: top-level Nest module
- `src/engine/`: Kafka consumer wiring and submit-command handling
- `src/expiration/`: expiration use cases and scheduler
- `src/health/`: health endpoint
- `src/runtime/`: provider tokens, runtime module, factories, and shutdown handling

The runtime providers compose:

- config loading from `@decade/infrastructure`
- JSON logging, clock, and ID generation
- PostgreSQL pool creation
- Kafka client, consumer, and publisher creation
- the shared in-memory `SymbolOrderBooks` cache

`EngineModule` imports `ExpirationModule`, so a single `matching-engine` process both consumes commands and runs the expiration scan loop.

## Shared Packages

### `packages/contracts`

This package defines the wire contracts shared across apps:

- `src/orders.ts`: HTTP request and response schemas
- `src/commands.ts`: `SubmitOrder` and `ExpireOrder` schemas
- `src/shared.ts`: shared Zod primitives

Read this package first if you want the public request and command shapes.

### `packages/exchange-core`

This is the pure exchange-domain package. It contains:

- branded/domain primitives
- order side and order status constants
- order and trade entities
- the in-memory `OrderBook`
- matching and execution-price policy code
- domain validation errors

This package holds the core matching behavior and has no dependency on the other workspace packages.

### `packages/application`

This package is the main orchestration layer, and it currently contains more than just abstract use cases.

Current contents:

- `src/use-cases/`: submit, read, process, and expire order flows
- `src/ports/`: clock, identity, logger, messaging, repository, and transaction interfaces
- `src/messages.ts` and `src/records.ts`: shared runtime record types
- `src/symbol-order-books.ts`: in-memory symbol-to-book cache
- `src/kafka/`: command codec, publisher, and consumer classes
- `src/postgres/`: repositories, mappers, advisory lock manager, and transaction manager

The Nest apps instantiate many of these concrete classes directly today. So, in the current codebase, `application` owns both:

- use-case orchestration
- most concrete Kafka and PostgreSQL adapter classes

### `packages/infrastructure`

This package contains environment-specific helpers and factories. It is smaller than `application`.

Current contents:

- `src/config/`: environment parsing and config tests
- `src/identity/`: request hashing and ID generation
- `src/logging/`: JSON console logger
- `src/time/`: system clock
- `src/kafka/kafka-client.ts`: KafkaJS client factory
- `src/postgres/postgres-pool.ts`: PostgreSQL pool factory

There are also internal files under `src/kafka/` and `src/postgres/` that re-export adapter classes from `@decade/application`. Those wrappers exist, but the apps primarily consume `infrastructure` for factories and environment-bound helpers.

### `packages/testing`

This package contains reusable testing helpers:

- `src/fixtures/top-sp500-most-active-symbols.ts`: sample symbol basket
- `src/kafka/`: command-topic sharding helpers, report script, and tests

It is focused on deterministic fixtures and sharding behavior, not a full end-to-end harness.

## Database And Infra Assets

### `db`

The `db` project contains:

- `migrations/0001_initial_schema.sql`: the current schema
- `scripts/apply-migrations.ts`: migration runner
- `scripts/reset-database.ts`: local reset helper
- `scripts/migrations.ts`: migration utilities
- `scripts/migrations.test.ts`: migration tests

The main schema creates:

- `orders`
- `trades`
- `order_events`
- `idempotency_keys`
- `processed_commands`

### `infra`

The `infra` directory contains local runtime assets:

- `infra/docker/`: Dockerfiles for both services
- `infra/compose/docker-compose.yml`: local stack for PostgreSQL, Kafka, topic initialization, HAProxy, and app containers
- `infra/haproxy/haproxy.cfg`: HAProxy config for the public API front door

## Dependency Direction

The current dependency flow is:

- `contracts` has no dependency on the other workspace packages.
- `exchange-core` is the pure domain package.
- `application` depends on `contracts` and `exchange-core`.
- `infrastructure` depends on `application`, `contracts`, and `exchange-core`.
- `apps/*` compose runtime behavior from `application` and `infrastructure`.
- `testing` depends on the packages it needs for fixtures and sharding helpers.

The important implementation nuance is that package boundaries are only partially strict right now. Concrete Kafka and PostgreSQL adapter classes still live in `packages/application`, while `packages/infrastructure` focuses on factories, env/config, and thin wrappers.

## Suggested Reading Order

For a quick pass through the codebase:

1. Read [`high-level-system-design.md`](./high-level-system-design.md).
2. Read `packages/contracts/src`.
3. Read `packages/exchange-core/src`.
4. Read `packages/application/src/use-cases` and `packages/application/src/symbol-order-books.ts`.
5. Read `apps/broker-api/src` and `apps/matching-engine/src`.
6. Read `packages/infrastructure/src`, `db/`, and `infra/`.
