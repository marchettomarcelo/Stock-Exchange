import type { OrderId } from "@decade/exchange-core";

import type { TradeRecord } from "../records";
import { mapTradeRow } from "./postgres-mappers";
import {
  getQueryable,
  type PostgresPool,
  type PostgresTransactionContext
} from "./postgres-types";

export class PostgresTradeRepository {
  constructor(private readonly pool: PostgresPool) {}

  async appendTrades(
    trades: TradeRecord[],
    context?: PostgresTransactionContext
  ): Promise<void> {
    if (trades.length === 0) {
      return;
    }

    const queryable = getQueryable(this.pool, context);

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

  async listTradesForOrder(
    orderId: OrderId,
    context?: PostgresTransactionContext
  ): Promise<TradeRecord[]> {
    const queryable = getQueryable(this.pool, context);
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
