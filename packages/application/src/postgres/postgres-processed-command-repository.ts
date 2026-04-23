import type { ProcessedCommandRecord } from "../records";
import { mapProcessedCommandRow } from "./postgres-mappers";
import {
  getQueryable,
  type PostgresPool,
  type PostgresTransactionContext
} from "./postgres-types";

export class PostgresProcessedCommandRepository {
  constructor(private readonly pool: PostgresPool) {}

  async markProcessed(
    record: ProcessedCommandRecord,
    context?: PostgresTransactionContext
  ): Promise<void> {
    const queryable = getQueryable(this.pool, context);

    await queryable.query(
      `
        INSERT INTO processed_commands (
          command_id,
          command_type,
          symbol,
          order_id,
          processed_at
        ) VALUES ($1, $2, $3, $4, $5)
      `,
      [
        record.commandId,
        record.commandType,
        record.symbol,
        record.orderId,
        record.processedAt
      ]
    );
  }

  async findByCommandId(
    commandId: string,
    context?: PostgresTransactionContext
  ): Promise<ProcessedCommandRecord | null> {
    const queryable = getQueryable(this.pool, context);
    const result = await queryable.query(
      `
        SELECT command_id, command_type, symbol, order_id, processed_at
        FROM processed_commands
        WHERE command_id = $1
      `,
      [commandId]
    );

    return result.rows[0] === undefined ? null : mapProcessedCommandRow(result.rows[0]);
  }
}
