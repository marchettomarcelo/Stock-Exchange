import type { OrderId, Symbol, IsoTimestamp } from "@decade/exchange-core";

import type {
  DueOrderRecord,
  PersistedOrderRecord,
  RecoveryOrderRecord
} from "../records";
import { mapDueOrderRow, mapOrderRow, mapRecoveryOrderRow } from "./postgres-mappers";
import {
  getQueryable,
  type PostgresPool,
  type PostgresQueryRow,
  type PostgresTransactionContext
} from "./postgres-types";

interface NumericRow extends PostgresQueryRow {
  value: number | string;
}

export class PostgresOrderRepository {
  constructor(private readonly pool: PostgresPool) {}

  async createAcceptedOrder(
    order: PersistedOrderRecord,
    context?: PostgresTransactionContext
  ): Promise<void> {
    const queryable = getQueryable(this.pool, context);

    await queryable.query(
      `
        INSERT INTO orders (
          order_id,
          broker_id,
          owner_document,
          symbol,
          side,
          price,
          original_quantity,
          remaining_quantity,
          status,
          valid_until,
          accepted_at,
          updated_at,
          resting_sequence
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
      `,
      [
        order.orderId,
        order.brokerId,
        order.ownerDocument,
        order.symbol,
        order.side,
        order.price,
        order.originalQuantity,
        order.remainingQuantity,
        order.status,
        order.validUntil,
        order.acceptedAt,
        order.updatedAt,
        order.restingSequence
      ]
    );
  }

  async updateOrder(
    order: PersistedOrderRecord,
    context?: PostgresTransactionContext
  ): Promise<void> {
    const queryable = getQueryable(this.pool, context);

    await queryable.query(
      `
        UPDATE orders
        SET
          broker_id = $2,
          owner_document = $3,
          symbol = $4,
          side = $5,
          price = $6,
          original_quantity = $7,
          remaining_quantity = $8,
          status = $9,
          valid_until = $10,
          accepted_at = $11,
          updated_at = $12,
          resting_sequence = $13
        WHERE order_id = $1
      `,
      [
        order.orderId,
        order.brokerId,
        order.ownerDocument,
        order.symbol,
        order.side,
        order.price,
        order.originalQuantity,
        order.remainingQuantity,
        order.status,
        order.validUntil,
        order.acceptedAt,
        order.updatedAt,
        order.restingSequence
      ]
    );
  }

  async findOrderById(
    orderId: OrderId,
    context?: PostgresTransactionContext
  ): Promise<PersistedOrderRecord | null> {
    const queryable = getQueryable(this.pool, context);
    const result = await queryable.query(
      `
        SELECT
          order_id,
          broker_id,
          owner_document,
          symbol,
          side,
          price,
          original_quantity,
          remaining_quantity,
          status,
          valid_until,
          accepted_at,
          updated_at,
          resting_sequence
        FROM orders
        WHERE order_id = $1
      `,
      [orderId]
    );

    return result.rows[0] === undefined ? null : mapOrderRow(result.rows[0]);
  }

  async listRestingOrdersForSymbol(
    symbol: Symbol,
    context?: PostgresTransactionContext
  ): Promise<RecoveryOrderRecord[]> {
    const queryable = getQueryable(this.pool, context);
    const result = await queryable.query(
      `
        SELECT
          order_id,
          broker_id,
          owner_document,
          symbol,
          side,
          price,
          original_quantity,
          remaining_quantity,
          status,
          valid_until,
          accepted_at,
          updated_at,
          resting_sequence
        FROM orders
        WHERE symbol = $1
          AND status IN ('open', 'partially_filled')
        ORDER BY resting_sequence ASC, order_id ASC
      `,
      [symbol]
    );

    return result.rows.map(mapRecoveryOrderRow);
  }

  async listDueOrders(
    asOf: IsoTimestamp,
    limit: number,
    context?: PostgresTransactionContext
  ): Promise<DueOrderRecord[]> {
    const queryable = getQueryable(this.pool, context);
    const result = await queryable.query(
      `
        SELECT order_id, symbol, valid_until, status
        FROM orders
        WHERE valid_until <= $1
          AND status IN ('accepted', 'open', 'partially_filled')
        ORDER BY valid_until ASC, order_id ASC
        LIMIT $2
      `,
      [asOf, limit]
    );

    return result.rows.map(mapDueOrderRow);
  }

  async nextRestingSequence(context?: PostgresTransactionContext): Promise<number> {
    const queryable = getQueryable(this.pool, context);
    const result = await queryable.query<NumericRow>(
      "SELECT nextval('order_resting_sequence_seq') AS value"
    );

    return Number(result.rows[0]?.value);
  }
}
