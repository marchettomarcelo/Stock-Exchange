import {
  PostgresTransactionContext,
  type PostgresPool
} from "./postgres-types";

export class PostgresTransactionManager {
  constructor(private readonly pool: PostgresPool) {}

  async withTransaction<T>(
    work: (context: PostgresTransactionContext) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    const context = new PostgresTransactionContext(client);

    await client.query("BEGIN");

    try {
      const result = await work(context);

      await client.query("COMMIT");

      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
