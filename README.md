# Decade

Decade is a small exchange prototype built as a TypeScript monorepo. It accepts broker orders, routes symbol-keyed commands through Kafka, matches them in horizontally scalable engine workers, and persists durable state in PostgreSQL.

## What It Does

- Accepts `POST /orders` and returns an exchange `order_id`
- Supports idempotent broker retries
- Matches orders with price-time priority
- Expires orders through the same ordered Kafka path used for submissions
- Serves `GET /orders/:orderId` from PostgreSQL


## Stack

- `apps/broker-api`: broker-facing NestJS API
- `apps/matching-engine`: matching workers and expiration scheduler
- `packages/exchange-core`: order book and matching rules
- `packages/application`: use cases and ports
- `packages/infrastructure`: Kafka, Postgres, config, logging adapters
- `db`: SQL migrations and DB scripts
- `infra/compose`: local Docker Compose runtime

## Run With Docker

Prerequisites: Docker, Node.js, and `corepack`/`pnpm`.

```bash
corepack pnpm install
corepack pnpm compose:infra:up
corepack pnpm compose:migrate
BROKER_API_INSTANCES=2 MATCHING_ENGINE_INSTANCES=2 KAFKA_COMMANDS_PARTITIONS=2 corepack pnpm compose:apps:up
```

Endpoints:

- API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Kafka external listener: `localhost:9094`

Useful commands:

```bash
corepack pnpm compose:logs
corepack pnpm compose:down
corepack pnpm test
corepack pnpm lint
corepack pnpm build
```


## API

### Submit order

`POST /orders`

```json
{
  "broker_id": "broker-1",
  "owner_document": "12345678900",
  "side": "bid",
  "symbol": "AAPL",
  "price": 18500,
  "quantity": 10,
  "valid_until": "2026-12-31T23:59:59Z",
  "idempotency_key": "order-001"
}
```

Response: `202 Accepted`

```json
{
  "order_id": "generated-by-exchange",
  "status": "accepted",
  "accepted_at": "2026-04-22T20:00:00.000Z"
}
```

### Get order status

`GET /orders/:orderId`

Returns the persisted state of the order. Status values are `accepted`, `open`, `partially_filled`, `filled`, and `expired`.

### Health checks

- `GET /health` on `broker-api`
- `GET /health` on `matching-engine`

## Notes

- Ordering is guaranteed per symbol by Kafka partitioning.
- Matching throughput scales up to the configured command partition count.
- Reads are eventually consistent with matching because acceptance and execution are separated.
