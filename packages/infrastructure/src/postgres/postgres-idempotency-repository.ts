import type { IdempotencyRecord, IdempotencyRepository } from "@decade/application";
import type { BrokerId } from "@decade/exchange-core";

import { mapIdempotencyRow } from "./postgres-mappers";
import { getQueryable, type PostgresPool } from "./postgres-types";

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly pool: PostgresPool) {}

  async create(record: IdempotencyRecord, context?: unknown): Promise<void> {
    const queryable = getQueryable(this.pool, context as never);

    await queryable.query(
      `
        INSERT INTO idempotency_keys (
          broker_id,
          idempotency_key,
          order_id,
          request_hash,
          created_at
        ) VALUES ($1, $2, $3, $4, $5)
      `,
      [
        record.brokerId,
        record.idempotencyKey,
        record.orderId,
        record.requestHash,
        record.createdAt
      ]
    );
  }

  async findByBrokerAndKey(
    brokerId: BrokerId,
    idempotencyKey: string,
    context?: unknown
  ): Promise<IdempotencyRecord | null> {
    const queryable = getQueryable(this.pool, context as never);
    const result = await queryable.query(
      `
        SELECT broker_id, idempotency_key, order_id, request_hash, created_at
        FROM idempotency_keys
        WHERE broker_id = $1 AND idempotency_key = $2
      `,
      [brokerId, idempotencyKey]
    );

    return result.rows[0] === undefined ? null : mapIdempotencyRow(result.rows[0]);
  }
}

