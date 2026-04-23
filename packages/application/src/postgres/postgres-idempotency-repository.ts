import type { BrokerId, IsoTimestamp } from "@decade/exchange-core";

import type { IdempotencyRecord } from "../records";
import { mapIdempotencyRow } from "./postgres-mappers";
import {
  getQueryable,
  type PostgresPool,
  type PostgresTransactionContext
} from "./postgres-types";

export class PostgresIdempotencyRepository {
  constructor(private readonly pool: PostgresPool) {}

  async create(
    record: IdempotencyRecord,
    context?: PostgresTransactionContext
  ): Promise<void> {
    const queryable = getQueryable(this.pool, context);

    await queryable.query(
      `
        INSERT INTO idempotency_keys (
          broker_id,
          idempotency_key,
          order_id,
          command_id,
          symbol,
          request_hash,
          publish_status,
          created_at,
          published_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        record.brokerId,
        record.idempotencyKey,
        record.orderId,
        record.commandId,
        record.symbol,
        record.requestHash,
        record.publishStatus,
        record.createdAt,
        record.publishedAt
      ]
    );
  }

  async findByBrokerAndKey(
    brokerId: BrokerId,
    idempotencyKey: string,
    context?: PostgresTransactionContext
  ): Promise<IdempotencyRecord | null> {
    const queryable = getQueryable(this.pool, context);
    const result = await queryable.query(
      `
        SELECT
          broker_id,
          idempotency_key,
          order_id,
          command_id,
          symbol,
          request_hash,
          publish_status,
          created_at,
          published_at
        FROM idempotency_keys
        WHERE broker_id = $1 AND idempotency_key = $2
      `,
      [brokerId, idempotencyKey]
    );

    return result.rows[0] === undefined ? null : mapIdempotencyRow(result.rows[0]);
  }

  async markPublished(
    brokerId: BrokerId,
    idempotencyKey: string,
    publishedAt: IsoTimestamp,
    context?: PostgresTransactionContext
  ): Promise<void> {
    const queryable = getQueryable(this.pool, context);

    await queryable.query(
      `
        UPDATE idempotency_keys
        SET
          publish_status = 'published',
          published_at = $3
        WHERE broker_id = $1 AND idempotency_key = $2
      `,
      [brokerId, idempotencyKey, publishedAt]
    );
  }
}
