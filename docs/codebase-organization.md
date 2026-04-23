# Codebase Organization

## Overview

This repository is a TypeScript monorepo for a small exchange system with two deployable applications:

- `broker-api`
- `matching-engine`

The codebase is organized around a few shared packages:

- `contracts` defines request, response, and command schemas
- `exchange-core` contains the matching engine domain logic
- `application` contains use cases, records, ports, and the current Kafka/PostgreSQL-facing classes used by the apps
- `infrastructure` contains runtime factories and environment-specific helpers
- `testing` contains reusable fixtures and Kafka sharding helpers

The repository currently also checks in generated `dist/` output and `tsconfig.tsbuildinfo` files for apps, packages, and the `db` project.

## Repository Shape

This is the current high-level layout:

```text
.
├── apps
│   ├── broker-api
│   │   ├── src
│   │   │   ├── app.module.ts
│   │   │   ├── main.ts
│   │   │   ├── health/
│   │   │   ├── orders/
│   │   │   ├── publishing/
│   │   │   └── runtime/
│   │   ├── test/
│   │   └── dist/
│   └── matching-engine
│       ├── src
│       │   ├── app.module.ts
│       │   ├── main.ts
│       │   ├── engine/
│       │   ├── expiration/
│       │   ├── health/
│       │   └── runtime/
│       ├── test/
│       └── dist/
├── packages
│   ├── application
│   │   ├── src
│   │   │   ├── kafka/
│   │   │   ├── ports/
│   │   │   ├── postgres/
│   │   │   ├── use-cases/
│   │   │   ├── messages.ts
│   │   │   ├── records.ts
│   │   │   └── symbol-order-books.ts
│   │   └── dist/
│   ├── contracts
│   │   ├── src
│   │   │   ├── commands.ts
│   │   │   ├── orders.ts
│   │   │   └── shared.ts
│   │   └── dist/
│   ├── exchange-core
│   │   ├── src
│   │   │   ├── book/
│   │   │   ├── entities/
│   │   │   ├── matching/
│   │   │   ├── policies/
│   │   │   └── primitives.ts
│   │   └── dist/
│   ├── infrastructure
│   │   ├── src
│   │   │   ├── config/
│   │   │   ├── identity/
│   │   │   ├── kafka/
│   │   │   ├── logging/
│   │   │   ├── postgres/
│   │   │   └── time/
│   │   └── dist/
│   └── testing
│       ├── src
│       │   ├── fixtures/
│       │   └── kafka/
│       └── dist/
├── db
│   ├── migrations/
│   ├── scripts/
│   └── dist/
├── docs/
├── infra
│   ├── compose/
│   ├── docker/
│   └── haproxy/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
├── nest-cli.json
└── eslint.config.mjs
```

At a glance:

- `apps/` contains deployable NestJS services
- `packages/` contains shared code
- `db/` contains SQL migrations and database scripts
- `infra/` contains local runtime assets such as Dockerfiles, Compose, and HAProxy config
- `docs/` contains the design and implementation notes for the project

## Applications

### `apps/broker-api`

This is the broker-facing HTTP service.

Current source layout:

- `main.ts` boots the Nest application
- `app.module.ts` wires the app-level module graph
- `orders/` contains the controller and module for `POST /orders` and `GET /orders/:orderId`
- `health/` contains the health endpoint
- `publishing/` contains publishing-related Nest module wiring
- `runtime/` contains provider definitions, tokens, and shutdown hooks

At runtime this app:

- validates and forwards order submissions into the application layer
- reads order status from PostgreSQL-backed repositories
- publishes commands to Kafka
- stays stateless between requests

### `apps/matching-engine`

This is the worker service that consumes exchange commands and advances order state.

Current source layout:

- `main.ts` boots the Nest application
- `app.module.ts` wires the app-level module graph
- `engine/` contains the Kafka consumer module and command handler entrypoint
- `expiration/` contains the expiration scheduler module
- `health/` contains the health endpoint
- `runtime/` contains provider definitions, tokens, and shutdown hooks

At runtime this app:

- consumes `SubmitOrder` and `ExpireOrder` commands from Kafka
- manages in-memory symbol books through `SymbolOrderBooks`
- persists order updates, trades, events, and processed-command markers
- runs expiration scans with a single active lease holder

## Shared Packages

### `packages/contracts`

This package defines the shared wire contracts.

Current contents:

- order request and response schemas in `orders.ts`
- command schemas in `commands.ts`
- shared schema helpers in `shared.ts`

This package is the source of truth for:

- `POST /orders` request validation shape
- accepted and status response payloads
- `SubmitOrder` and `ExpireOrder` command payloads

### `packages/exchange-core`

This package contains the pure exchange domain model.

Current contents:

- value and branded primitives in `primitives.ts` and `brand.ts`
- domain enums and constants
- `OrderBook` and `PriceLevel`
- order and trade entities
- matching and execution-price policies
- domain validation errors

This is the best package to read first if the goal is to understand:

- price-time priority
- matching behavior
- partial fill handling
- expiration logic inside the live book

### `packages/application`

This package contains the orchestration layer and the core runtime-facing abstractions used by the apps today.

Current contents:

- use cases in `src/use-cases/`
- port interfaces in `src/ports/`
- command and repository record shapes in `messages.ts` and `records.ts`
- the in-memory symbol book cache in `symbol-order-books.ts`
- Kafka command codec, publisher, and consumer classes in `src/kafka/`
- PostgreSQL repository, mapper, and transaction classes in `src/postgres/`

In the current codebase, this package is doing more than just pure use-case orchestration. It also contains the classes that the Nest runtime composes directly for:

- order submission
- order status reads
- command processing
- expiration scans
- Kafka encode/decode and publish/consume
- PostgreSQL persistence and transaction handling

That makes `application` the largest shared package in the repo today.

### `packages/infrastructure`

This package contains environment-specific helpers and runtime factories.

Current contents:

- config loading in `config/`
- ID generation and request hashing in `identity/`
- Kafka client creation in `kafka/kafka-client.ts`
- JSON logger wiring in `logging/`
- PostgreSQL pool creation in `postgres/postgres-pool.ts`
- wall-clock time in `time/system-clock.ts`

There are also `kafka/` and `postgres/` files that currently re-export classes from `@decade/application`. Those exist as compatibility wrappers, but the main public surface exported from `src/index.ts` is the runtime helper layer rather than a full adapter implementation package.

### `packages/testing`

This package is intentionally small.

Current contents:

- symbol fixtures in `fixtures/top-sp500-most-active-symbols.ts`
- Kafka sharding helpers and tests in `kafka/`

It is used for reusable test data and deterministic topic-partition calculations rather than broader end-to-end test harnesses.

## Database And Infrastructure Assets

### `db`

The `db` project contains:

- SQL migrations in `db/migrations/`
- migration helpers in `db/scripts/migrations.ts`
- runnable scripts such as `apply-migrations.ts` and `reset-database.ts`
- migration-focused tests in `db/scripts/migrations.test.ts`

The main schema currently creates:

- `orders`
- `trades`
- `order_events`
- `idempotency_keys`
- `processed_commands`

### `infra`

The `infra` directory contains local runtime assets:

- Dockerfiles for both services in `infra/docker/`
- local Compose configuration in `infra/compose/`
- HAProxy configuration in `infra/haproxy/`

This is the operational entrypoint for running the stack locally.

## Dependency Direction

The current dependency story is:

- `contracts` depends on no application-specific packages
- `exchange-core` is the pure domain package and does not depend on the other workspace packages
- `application` depends on `contracts` and `exchange-core`
- `infrastructure` depends on `application`, `contracts`, and `exchange-core`
- `apps/*` depend on the shared packages and compose the runtime
- `testing` depends on whatever helpers it needs for test support

One important nuance in the current codebase: the repository and messaging boundaries are only partially separated. Interface-style ports exist in `packages/application/src/ports`, but the concrete Kafka and PostgreSQL classes currently live in `packages/application/src/kafka` and `packages/application/src/postgres`, with `packages/infrastructure` providing runtime factories around them.

## Testing Layout

Tests are spread across the repo by concern:

- `packages/exchange-core` focuses on matching and primitive invariants
- `packages/contracts` focuses on schema validation
- `packages/application` focuses on use-case orchestration
- `packages/infrastructure` focuses on config, identity, Kafka helpers, and PostgreSQL repositories
- `apps/broker-api` and `apps/matching-engine` contain app-level tests
- `db` contains migration tests

The current setup is mostly unit and focused integration testing rather than a full end-to-end suite.

## How To Read The Codebase

For a first pass through the repository, this order matches the current implementation well:

1. Read `docs/high-level-system-design.md` for the system model.
2. Read `packages/contracts` for API and command shapes.
3. Read `packages/exchange-core` for the matching rules.
4. Read `packages/application/src/use-cases` and `symbol-order-books.ts` for orchestration.
5. Read `apps/broker-api` and `apps/matching-engine` for Nest runtime composition.
6. Read `packages/infrastructure` and `db` for environment wiring and persistence setup.

That path moves from system behavior to runtime composition without assuming cleaner package boundaries than the repository currently has.
