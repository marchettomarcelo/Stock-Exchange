import type { TradeRecord, TradeRepository } from "@decade/application";
import type { OrderId } from "@decade/exchange-core";

import { mapTradeRow } from "./postgres-mappers";
import { getQueryable, type PostgresPool } from "./postgres-types";

export class PostgresTradeRepository implements TradeRepository {
  constructor(private readonly pool: PostgresPool) {}

  async appendTrades(trades: TradeRecord[], context?: unknown): Promise<void> {
    if (trades.length === 0) {
      return;
    }

    const queryable = getQueryable(this.pool, context as never);

    for (const trade of trades) {
      await queryable.query(
        `
          INSERT INTO trades (
            symbol,
            buy_order_id,
            sell_order_id,
            price,
            quantity,
            executed_at
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          trade.symbol,
          trade.buyOrderId,
          trade.sellOrderId,
          trade.price,
          trade.quantity,
          trade.executedAt
        ]
      );
    }
  }

  async listTradesForOrder(orderId: OrderId, context?: unknown): Promise<TradeRecord[]> {
    const queryable = getQueryable(this.pool, context as never);
    const result = await queryable.query(
      `
        SELECT
          trade_id,
          symbol,
          buy_order_id,
          sell_order_id,
          price,
          quantity,
          executed_at
        FROM trades
        WHERE buy_order_id = $1 OR sell_order_id = $1
        ORDER BY trade_id ASC
      `,
      [orderId]
    );

    return result.rows.map(mapTradeRow);
  }
}

