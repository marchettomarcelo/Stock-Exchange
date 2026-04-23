import type { OrderId } from "@decade/exchange-core";

import type { OrderEventRecord } from "../records";
import { mapOrderEventRow } from "./postgres-mappers";
import {
  getQueryable,
  type PostgresPool,
  type PostgresTransactionContext
} from "./postgres-types";

export class PostgresOrderEventRepository {
  constructor(private readonly pool: PostgresPool) {}

  async appendEvents(
    events: OrderEventRecord[],
    context?: PostgresTransactionContext
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const queryable = getQueryable(this.pool, context);

    for (const event of events) {
      await queryable.query(
        `
          INSERT INTO order_events (
            order_id,
            event_type,
            payload,
            created_at
          ) VALUES ($1, $2, $3::jsonb, $4)
        `,
        [event.orderId, event.eventType, JSON.stringify(event.payload), event.createdAt]
      );
    }
  }

  async listEventsForOrder(
    orderId: OrderId,
    context?: PostgresTransactionContext
  ): Promise<OrderEventRecord[]> {
    const queryable = getQueryable(this.pool, context);
    const result = await queryable.query(
      `
        SELECT event_id, order_id, event_type, payload, created_at
        FROM order_events
        WHERE order_id = $1
        ORDER BY event_id ASC
      `,
      [orderId]
    );

    return result.rows.map(mapOrderEventRow);
  }
}
