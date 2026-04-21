# Local Runtime

This compose stack starts PostgreSQL, Kafka, a public `broker-api` proxy, a configurable number of `broker-api` replicas, and a configurable number of `matching-engine` replicas for local development.

## Startup Sequence

From the repository root:

1. Start infrastructure:
   `corepack pnpm compose:infra:up`
2. Apply migrations:
   `corepack pnpm compose:migrate`
3. Start the application services:
   `BROKER_API_INSTANCES=2 MATCHING_ENGINE_INSTANCES=2 KAFKA_COMMANDS_PARTITIONS=2 corepack pnpm compose:apps:up`

The public endpoints are:

- `broker-api`: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Kafka external listener: `localhost:9094`

`broker-api` is now scaled as an internal service behind the public HAProxy front door on `localhost:3000`. `matching-engine` remains an internal worker service. Inspect the replica count with `docker compose -f infra/compose/docker-compose.yml ps`.

To tail logs:

`corepack pnpm compose:logs`

To tear the stack down and remove local volumes:

`corepack pnpm compose:down`

## Notes

- Both application containers run the TypeScript entrypoints with `tsx`, which matches the current workspace runtime model.
- HAProxy load-balances requests across the `broker-api` replicas using Docker DNS discovery and `GET /health` checks.
- The scheduler publishes expiration commands into the same Kafka topic used for order submissions.
- The local stack pre-creates `exchange.commands` through the `topic-init` service, using `KAFKA_COMMANDS_PARTITIONS` to control the shard count.
- `topic-init` can raise the topic partition count on repeated runs. To reduce the partition count again, rebuild the stack from scratch with `docker compose -f infra/compose/docker-compose.yml down -v`.
- Set `BROKER_API_INSTANCES` to control the number of API replicas. The default local value is `2`.
- The default local validation basket is `NVDA`, `NFLX`, `INTC`, `TSLA`, `AMZN`, `AAPL`, `PLTR`, `ORCL`, `MSFT`, and `F`.
- With `2` partitions, Kafka-native key hashing currently splits that basket `4/6` across partitions, not `5/5`. Use `corepack pnpm sharding:report` to see the checked-in partition assignment.
