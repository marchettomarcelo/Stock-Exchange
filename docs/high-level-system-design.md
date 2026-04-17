# High-Level System Design

## Purpose

This document describes a high-level architecture for implementing the stock exchange system defined in [engineering-case-marcelo.md](/Users/marcelomarchetto/Desktop/decade/docs/engineering-case-marcelo.md).

The goal is to design a system that is:

- correct in terms of matching behavior
- deterministic under concurrency
- fast on the hot path
- recoverable after failures
- easy to evolve toward a more exchange-grade architecture

This document intentionally stays at the system-design level and does not prescribe implementation details or code.

## Scope

The required core behavior is:

- brokers submit buy and sell orders
- the system assigns an order identifier
- orders can be queried later by identifier
- orders are matched by symbol, price, validity, and time priority
- partial fills are supported
- when a bid and ask cross, execution happens at the seller price

Out of scope for the initial design:

- brokerage accounts and balances
- custody and settlement
- KYC, AML, and customer compliance workflows
- advanced market mechanisms such as auctions or market orders
- multi-region deployment

## Core Design Principles

### 1. Single writer per symbol

For any given stock symbol, matching must happen through exactly one active sequencer at a time.

This is the most important architectural rule because it guarantees:

- deterministic price-time priority
- no race conditions inside one order book
- simpler correctness reasoning
- lower locking overhead on the hot path

### 2. In-memory matching, durable persistence

The matching engine should keep active order books in memory for speed, while persisting accepted orders, executions, and state transitions durably for recovery and auditability.

### 3. Explicit separation of write and read paths

The write path should be optimized for order acceptance and matching. Querying order state should be served from persisted state or read projections, not by directly inspecting engine internals.

### 4. Deterministic ordering

The exchange, not the client, should assign the authoritative sequence for order processing. Client timestamps are not sufficient for strict chronological ordering.

## Proposed System Architecture

The system should begin as a modular monolith with clear internal boundaries. This keeps operations simple while preserving a clean path to future partitioning and service extraction.

Core modules:

- `Broker API`
- `Validation and Intake`
- `Routing and Partitioning`
- `Matching Engine`
- `Persistence Layer`
- `Read Model / Query Layer`
- `Expiration Worker`
- `Observability and Operations`

## Main Components

### Broker API

Responsibilities:

- accept new orders
- return an exchange order identifier
- expose order status lookup

Minimum endpoints:

- `POST /orders`
- `GET /orders/{order_id}`

Simplified payloads:

`POST /orders` request

```json
{
  "broker_id": "broker-123",
  "document_number": "12345678900",
  "side": "bid",
  "symbol": "AAPL",
  "price": 1050,
  "quantity": 1000,
  "valid_until": "2026-04-17T18:30:00Z"
}
```

`POST /orders` response

```json
{
  "order_id": "ord_01JXYZ123",
  "status": "accepted"
}
```

`GET /orders/{order_id}` response

```json
{
  "order_id": "ord_01JXYZ123",
  "broker_id": "broker-123",
  "symbol": "AAPL",
  "side": "bid",
  "price": 1050,
  "original_quantity": 1000,
  "remaining_quantity": 400,
  "status": "partially_filled",
  "valid_until": "2026-04-17T18:30:00Z"
}
```

### Validation and Intake

Responsibilities:

- validate required fields
- validate side, symbol, price, quantity, and validity window
- reject malformed or already expired orders
- assign exchange-owned metadata such as internal sequence and acceptance time

This layer should also support idempotency so broker retries do not create duplicate orders.

### Routing and Partitioning

The system should not start with one physical process per stock.

Instead, it should start with:

- `N` engine partitions
- each partition owning many symbols
- symbol-to-partition routing by deterministic hash

This gives concurrency across symbols while preserving a single ordered stream per symbol.

If a symbol becomes very hot later, it can be promoted to a dedicated partition.

### Matching Engine

The engine is the core of the system.

Each symbol has:

- a bid book
- an ask book

These should not be treated as in-memory databases. They should be treated as engine-owned in-memory ordered data structures.

At a high level:

- the bid book contains buy orders
- the ask book contains sell orders
- the bid side is ordered by highest price first, then earliest accepted order first
- the ask side is ordered by lowest price first, then earliest accepted order first

A practical internal model is:

- one order book per symbol
- two sides inside the book: bids and asks
- each side implemented as a sorted price index
- each price level containing a FIFO queue of orders

Example shape:

- bids
- `10.50 -> [order1, order2]`
- `10.25 -> [order3]`
- asks
- `10.75 -> [order4]`
- `11.00 -> [order5, order6]`

This structure gives the engine the operations it needs efficiently:

- get the best bid from the highest active bid price level
- get the best ask from the lowest active ask price level
- preserve time priority within the same price level using FIFO order

The engine will also typically maintain supporting in-memory indexes such as:

- `order_id -> order record`
- `order_id -> location in the book`

These indexes are useful for fast status lookup inside the engine and become especially important once cancel and replace operations are added.

Matching rules:

- only orders for the same symbol can match
- bids are prioritized by highest price, then earliest accepted order
- asks are prioritized by lowest price, then earliest accepted order
- a trade occurs when best bid is greater than or equal to best ask
- execution price is the seller price
- partial fills are allowed
- remaining quantity stays active until filled or expired

Because matching is stateful and order-sensitive, all mutations to a symbol book should happen only inside the engine partition that owns that symbol.

### Persistence Layer

The persistence layer stores:

- current order state
- trade executions
- immutable order events
- engine snapshots or recovery checkpoints

At minimum, it should support:

- durable storage of accepted orders
- storage of every execution event
- enough state to rebuild or replay the engine after a crash

### Read Model / Query Layer

This layer exists to serve brokers efficiently.

Responsibilities:

- return current order status by order id
- return fill details or execution history
- support future operational dashboards and reporting

This should be isolated from the hot write path so heavy reads do not interfere with matching throughput.

### Expiration Worker

Orders include a validity deadline, so the system needs expiration handling.

The design should use two protections:

- a background expiration process that marks orders expired
- an in-engine validation check before any match is executed

This prevents stale orders from executing because of scheduler lag.


## Order Lifecycle

### Submission flow

1. Broker submits an order through the API.
2. Intake validates the payload and broker-level metadata.
3. The system assigns an order identifier and internal sequence metadata.
4. The order is routed to the owning partition for its symbol.
5. The engine tries to match it immediately against the opposite side of the book.
6. The engine emits zero or more executions.
7. Any unfilled quantity is stored as a resting order if still valid.
8. The resulting state is persisted.
9. The API responds with the order identifier and current status.

### Query flow

1. Broker requests an order by identifier.
2. The query layer reads the current order state from persisted storage or a read projection.
3. The system returns status, remaining quantity, and execution summary.

## Data Model

At a high level, the system needs four data categories.

### Orders

Represents current order state.

Fields should include:

- order id
- broker id
- owner document number
- side
- symbol
- limit price
- original quantity
- remaining quantity
- valid until
- status
- accepted timestamp
- internal sequence number

### Trades

Represents each execution.

Fields should include:

- trade id
- buy order id
- sell order id
- symbol
- executed quantity
- execution price
- execution timestamp
- execution sequence

### Order Events

Represents the immutable lifecycle trail.

Examples:

- order accepted
- partially filled
- fully filled
- expired
- rejected
- canceled
- replaced

### Engine Snapshots

Represents recovery state for each partition or symbol group.

Used to restore in-memory books quickly without replaying all historical events from the beginning.

## Why This Design Is Performant

The main performance advantages are architectural:

- active books stay in memory
- there is no lock contention inside a symbol stream
- matching avoids synchronous cross-service calls
- writes are localized to a partition owner
- reads are separated from matching

This design is also efficient under uneven traffic because multiple symbols can share the same partition until a hot symbol needs isolation.

## Why This Design Is Robust

The main robustness advantages are:

- deterministic sequencing
- explicit ownership of book mutation
- durable storage of state transitions
- clear recovery path
- idempotent submission support
- built-in expiration enforcement

The key idea is that correctness comes from controlled ordering, and recovery comes from durable events plus snapshots.

## Future Architecture Roadmap

This section focuses on the core system architecture only.

### V1: Must-Have for Initial Delivery

The first version should include the minimum architecture required to be correct, fast, and testable.

#### Core engine

- single active writer per symbol
- partitioned matching engine
- in-memory bid and ask books
- deterministic price-time priority
- partial fill support
- seller-price execution rule

#### Core API

- order submission endpoint
- order status endpoint
- exchange-generated order identifiers
- basic idempotency support for retries

#### Persistence

- durable order storage
- durable trade storage
- persisted order statuses
- immutable event records for key transitions

#### Operations

- containerized runtime
- startup migrations or schema initialization
- health and readiness endpoints
- structured logging
- baseline metrics

#### Testing

- deterministic matching tests
- chronological priority tests
- partial fill tests
- expiry tests
- duplicate submission tests
