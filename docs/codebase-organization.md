# Codebase Organization Proposal

## Purpose

This document defines how the codebase should be organized to implement the exchange described in [high-level-system-design.md](/Users/marcelomarchetto/Desktop/decade/docs/high-level-system-design.md) and [engineering-case-marcelo.md](/Users/marcelomarchetto/Desktop/decade/docs/engineering-case-marcelo.md).

The target implementation stack is:

- NestJS for application structure and dependency injection
- TypeScript for all application and domain code
- a modular monolith as the initial runtime shape
- clear internal boundaries so hot-path modules can later be extracted if needed

## Architectural Direction

The codebase should start as a NestJS monorepo with:

- one primary HTTP application for broker-facing APIs
- one worker application for asynchronous expiry processing
- shared libraries for domain logic, matching, persistence, and observability

This preserves the intent from the high-level design:

- matching stays in-process and fast
- symbol ownership remains deterministic
- read and write concerns stay separated in code
- future extraction into independent services remains feasible

## Recommended Repository Layout

```text
.
├── apps
│   ├── exchange-api
│   │   ├── src
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── bootstrap
│   │   │   └── modules
│   │   └── test
│   └── expiration-worker
│       ├── src
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   └── modules
│       └── test
├── libs
│   ├── broker-api
│   ├── intake
│   ├── routing
│   ├── matching-engine
│   ├── persistence
│   ├── query
│   ├── expiration
│   ├── domain
│   ├── contracts
│   ├── config
│   ├── observability
│   └── testing
├── db
│   ├── migrations
│   ├── seeds
│   └── schema
├── docker
│   ├── Dockerfile
│   └── compose.yml
├── docs
├── package.json
├── pnpm-workspace.yaml
├── nest-cli.json
├── tsconfig.base.json
└── eslint.config.mjs
```

## Why This Layout

### `apps/`

`apps/` should contain deployable NestJS applications only.

- `exchange-api` handles HTTP traffic, intake, routing, matching coordination, and order queries
- `expiration-worker` runs expiry scans and expiration commands outside the request path

### `libs/`

`libs/` should contain reusable internal modules with strict boundaries.

- domain and engine logic live here
- infrastructure integrations live here
- transport-specific code stays out of pure business modules

### `db/`

`db/` should contain migration and schema assets owned by the persistence layer.

### `docker/`

`docker/` should hold the OCI-compliant runtime definition required by the case.

## Workflow Diagrams

### High-Level Runtime View

```text
Broker Client
    |
    v
apps/exchange-api
    |
    +--> libs/broker-api
            |
            +--> libs/intake
            |      |
            |      +--> libs/routing
            |              |
            |              +--> libs/matching-engine
            |                       |
            |                       +--> libs/persistence --> PostgreSQL
            |
            +--> libs/query
                    |
                    +--> libs/persistence --> PostgreSQL

apps/expiration-worker
    |
    +--> libs/expiration
            |
            +--> libs/persistence --> PostgreSQL
```

This is the main runtime shape:

- brokers interact only with the API app
- the API app owns the write path and query entrypoints
- the worker app handles background expiration outside the request path
- PostgreSQL remains the durable source of truth

### Order Submission And Matching Flow

```text
Broker
  |
  | POST /orders
  v
exchange-api
  |
  | validate and normalize payload
  v
intake
  |
  | check idempotency key and reserve order metadata
  v
persistence
  |
  | dispatch accepted order command
  v
routing
  |
  | route by symbol to owning partition
  v
symbol partition + matching-engine
  |
  | apply price-time priority matching
  | persist order state, trades, and events
  v
persistence
  |
  | update read model / query state
  v
query projection
  |
  | return current order status
  v
exchange-api
  |
  | order_id + status
  v
Broker
```

This diagram reflects the intended write path:

- validation and idempotency happen before the order reaches the book
- routing ensures one active writer per symbol stream
- matching happens in memory
- persistence and query updates happen after the engine decides outcomes

### In-Partition Matching Logic

```text
Accepted order arrives in owning partition
                |
                v
         [Still valid?]
            |       |
          no|       |yes
            v       v
   Mark expired   Inspect best opposing
   and emit event   price level
                        |
                        v
                  [Prices cross?]
                    |         |
                  no|         |yes
                    v         v
           Add remaining   Execute against
           quantity to     head order at
           own side        seller price
           of book             |
                               v
                        [Quantity left?]
                           |         |
                         no|         |yes
                           v         |
                  Order fully handled|
                                     |
                                     +--> back to "Inspect best opposing price level"
```

This is the hot-path logic inside `libs/matching-engine`:

- the partition checks validity before attempting a match
- the engine compares only against the best opposing price level
- each execution uses seller price
- any remainder either continues matching or rests on the book

### Expiration And Query Flow

```text
expiration-worker
  |
  | scheduled scan
  v
expiration
  |
  | select due live orders
  v
persistence
  |
  | return expired order batch
  v
expiration
  |
  | mark expired and append events
  v
persistence
  |
  | refresh read-side state
  v
query

Broker
  |
  | GET /orders/:orderId
  v
exchange-api
  |
  | fetch order status
  v
query
  |
  | read current order state
  v
persistence
  |
  | status, remaining quantity, fills
  v
query
  |
  v
exchange-api
  |
  v
Broker
```

This separates concerns cleanly:

- expiry is enforced in the background for resting orders
- the read side serves broker lookups from persisted state
- the engine still guards against stale execution if the worker lags

## Core Module Map

Each core module from the design docs should map to one NestJS library.

| Core module | NestJS boundary | Responsibilities | Recommended technologies |
| --- | --- | --- | --- |
| Broker API | `libs/broker-api` | HTTP endpoints, DTO mapping, response formatting, OpenAPI docs | NestJS controllers, `@nestjs/platform-fastify`, `@nestjs/swagger`, `nestjs-zod` |
| Validation and Intake | `libs/intake` | payload validation, idempotency checks, exchange-owned metadata assignment | NestJS providers, Zod schemas, PostgreSQL-backed idempotency table, `uuid` v7 or ULID generation |
| Routing and Partitioning | `libs/routing` | symbol hashing, partition ownership, single-writer dispatch | pure TypeScript services, `xxhash` for deterministic hashing, in-memory async partition queues |
| Matching Engine | `libs/matching-engine` | order-book mutation, price-time priority, matching, partial fills | framework-free TypeScript, `sorted-btree` for price levels, `denque` for FIFO queues, integer money values |
| Persistence Layer | `libs/persistence` | order storage, trades, events, snapshots, transactions | PostgreSQL 16, Kysely, `pg`, SQL migrations in `db/migrations` |
| Read Model / Query Layer | `libs/query` | order status lookup, fill history, read projections | NestJS query services, PostgreSQL read tables and indexes, optional Redis cache later |
| Expiration Worker | `libs/expiration` plus `apps/expiration-worker` | due-order detection and expiration commands | NestJS standalone app, `@nestjs/schedule`, PostgreSQL polling with `FOR UPDATE SKIP LOCKED` |
| Observability and Operations | `libs/observability` | logging, traces, metrics, health endpoints | `nestjs-pino`, OpenTelemetry, `prom-client`, `@nestjs/terminus` |

## Detailed Library Responsibilities

### `libs/domain`

This should contain the exchange domain model with no NestJS dependencies.

Contents:

- entities such as `Order`, `Trade`, and `OrderBookSnapshot`
- value objects such as `Price`, `Quantity`, `Symbol`, and `OrderId`
- enums such as `OrderSide` and `OrderStatus`
- domain events such as `OrderAccepted`, `TradeExecuted`, and `OrderExpired`
- domain errors and invariants

Rules:

- no controllers
- no repositories
- no SQL
- no framework decorators

### `libs/contracts`

This should define API-facing and integration-facing contracts shared across modules.

Contents:

- request and response schemas
- event payload types
- projection DTOs
- shared serialization helpers

Use this to avoid leaking persistence entities into the API layer.

### `libs/broker-api`

This library should expose the broker-facing NestJS controllers and transport adapters.

Contents:

- `OrdersController`
- request validation pipes
- response mappers
- OpenAPI decorators
- exception filters for broker-safe error payloads

This module should depend on application services from `intake` and `query`, not on database classes directly.

### `libs/intake`

This library should orchestrate order acceptance before the order reaches the book.

Contents:

- order submission use case
- idempotency service
- request normalization
- acceptance timestamp generation
- authoritative sequence metadata assignment
- command object creation for routing

This is the right place to validate:

- symbol format
- positive price and quantity
- supported side
- non-expired validity window
- broker-required fields

### `libs/routing`

This library should own partition decisions and single-writer guarantees.

Contents:

- symbol-to-partition hash strategy
- partition registry
- partition queue abstraction
- dispatch service for engine commands

For V1, this should remain in-process. The abstraction should still be explicit so a future version can replace local queues with dedicated partition processes.

### `libs/matching-engine`

This is the hottest module and should stay pure TypeScript.

Contents:

- `OrderBook`
- `BidBookSide`
- `AskBookSide`
- matching policies
- execution generation
- expiry checks before match
- snapshot and replay support

Rules:

- no NestJS imports
- no ORM or repository imports
- no HTTP knowledge
- use integers for price and quantity, never floating-point

Recommended internal structures:

- ordered map of price levels for each side
- FIFO queue per price level
- `orderId -> order state` index
- `orderId -> book location` index

### `libs/persistence`

This library should encapsulate all database access.

Contents:

- repositories for orders, trades, events, and snapshots
- transaction boundary helpers
- projection writers
- migration helpers

Suggested tables:

- `orders`
- `trades`
- `order_events`
- `engine_snapshots`
- `idempotency_keys`

Kysely is a good fit here because the system will need explicit SQL control, strong typing, and predictable transactions without heavy ORM abstractions.

### `libs/query`

This library should serve read use cases without reaching into engine internals.

Contents:

- order status query service
- trade history query service
- read-model mappers
- projection repository

The initial version can read from normalized PostgreSQL tables. If query traffic becomes high, a Redis cache can be added behind this module without changing controllers.

### `libs/expiration`

This library should contain the logic used by the worker application to expire resting orders.

Contents:

- due-order scanner
- expiration command issuer
- batch processing policies
- retry logic for transient database failures

The worker should mark orders expired durably and also emit the right lifecycle events. The matching engine must still perform an in-engine validity check so scheduler lag cannot create stale executions.

### `libs/observability`

This library should centralize cross-cutting runtime concerns.

Contents:

- logger module
- tracing module
- metrics module
- health indicators
- correlation-id utilities

This avoids observability code being reimplemented in every app.

### `libs/config`

This library should own typed environment parsing and application settings.

Contents:

- Zod env schema
- typed config factories
- app, database, engine, and observability config groups

No module should read `process.env` directly outside this library.

### `libs/testing`

This library should centralize test helpers.

Contents:

- order fixture builders
- fake clock
- repository test harnesses
- deterministic engine assertions
- API bootstrap helpers for e2e tests

## Application Composition

### `apps/exchange-api`

This app should compose the request path:

1. `broker-api`
2. `intake`
3. `routing`
4. `matching-engine`
5. `persistence`
6. `query`
7. `observability`
8. `config`

Key responsibilities:

- expose `POST /orders`
- expose `GET /orders/:orderId`
- coordinate acceptance, routing, matching, persistence, and read-model updates
- expose health, readiness, and metrics endpoints

### `apps/expiration-worker`

This app should compose:

1. `expiration`
2. `persistence`
3. `observability`
4. `config`

Key responsibilities:

- scan for expired live orders
- mark them expired safely in batches
- emit expiration events
- update read models if needed

## Dependency Rules

The codebase should follow these dependency rules:

- `apps/*` may depend on any `libs/*`
- `broker-api` may depend on `contracts`, `intake`, `query`, `observability`, and `config`
- `intake` may depend on `domain`, `contracts`, `routing`, `persistence`, and `config`
- `routing` may depend on `domain`, `matching-engine`, `persistence`, and `observability`
- `matching-engine` may depend only on `domain`
- `query` may depend on `domain`, `contracts`, and `persistence`
- `expiration` may depend on `domain`, `routing`, `persistence`, and `observability`
- `persistence` may depend on `domain`, `contracts`, and `config`
- `domain` and `contracts` must not depend on NestJS infrastructure

The important boundary is this:

- the matching engine must never know about HTTP, NestJS decorators, or SQL

## Suggested Internal Structure Per Library

Each business-oriented library should use the same layout:

```text
libs/<module>/src
├── application
├── domain
├── infrastructure
├── presentation
└── index.ts
```

Interpretation:

- `application` contains use cases and orchestration
- `domain` contains module-specific business rules if needed
- `infrastructure` contains storage or framework adapters
- `presentation` contains controllers, consumers, or external adapters when relevant

Not every library needs every folder. For example, `matching-engine` should mostly contain `domain` and `application`, while `broker-api` will lean on `presentation`.

## Persistence Strategy

The database should be organized for both write durability and query efficiency.

Recommended choices:

- PostgreSQL 16 as the primary system of record
- one migration folder managed in-repo
- explicit SQL indexes for `order_id`, `symbol`, `status`, `valid_until`, and execution lookup paths
- transactional writes for order acceptance and trade persistence

Storage responsibilities:

- `orders` stores current order state
- `trades` stores every execution
- `order_events` stores the immutable lifecycle trail
- `engine_snapshots` stores replay checkpoints
- query projections can initially be derived from the same tables, then split later if necessary

## Testing Strategy

The repo should treat testing as part of the design, not as a later add-on.

Recommended stack:

- Vitest for unit and integration tests
- Nest testing utilities for module bootstrapping
- Supertest for HTTP e2e coverage
- Testcontainers for PostgreSQL-backed integration tests
- `fast-check` for matching-engine invariant tests

Minimum test suites:

- price-time priority
- seller-price execution
- partial fills
- expired order rejection
- idempotent retries
- snapshot and replay recovery

## Build and Tooling

Recommended project tooling:

- `pnpm` workspaces for package management
- Nest CLI monorepo mode for app and library generation
- TypeScript project references through `tsconfig.base.json`
- ESLint for linting
- Prettier for formatting
- Husky plus lint-staged if local git hooks are desired

Avoid adding unnecessary platform complexity at the start. A plain NestJS monorepo is enough for this system; Nx can be added later only if the repository grows materially.

## Runtime and Operations

The initial operational stack should be simple and reproducible.

Recommended choices:

- multi-stage Docker build
- Docker Compose for local development with PostgreSQL
- health and readiness endpoints in the API app
- structured JSON logs
- Prometheus metrics endpoint
- OpenTelemetry traces for request-to-engine flow visibility

## Implementation Notes

A few design constraints should be treated as non-negotiable from day one:

- money and quantity values must be stored as integers, not floats
- order identifiers returned to brokers should be public-safe and opaque
- internal sequencing should be exchange-owned and independent of client timestamps
- matching must remain single-writer per symbol
- read queries must not inspect live in-memory books directly

## Recommended First Milestone

The first implementation slice should create:

1. monorepo scaffolding with `apps/exchange-api`, `apps/expiration-worker`, and the core `libs/*`
2. the pure `matching-engine` library with deterministic tests
3. PostgreSQL persistence for orders, trades, and events
4. `POST /orders` and `GET /orders/:orderId`
5. expiry worker plus baseline observability and containerization

This gives a codebase that matches the case requirements while preserving a clean path to future scaling.
