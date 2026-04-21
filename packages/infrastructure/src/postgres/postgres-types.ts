import type { TransactionContext } from "@decade/application";

export interface PostgresQueryRow {
  [key: string]: unknown;
}

export interface PostgresQueryResult<TRow extends PostgresQueryRow = PostgresQueryRow> {
  rows: TRow[];
}

export interface PostgresQueryable {
  query<TRow extends PostgresQueryRow = PostgresQueryRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<PostgresQueryResult<TRow>>;
}

export interface PostgresPoolClient extends PostgresQueryable {
  release(): void;
}

export interface PostgresPool extends PostgresQueryable {
  connect(): Promise<PostgresPoolClient>;
  end?(): Promise<void>;
}

export class PostgresTransactionContext implements TransactionContext {
  readonly kind = "transaction" as const;

  constructor(public readonly client: PostgresPoolClient) {}
}

export function getQueryable(
  pool: PostgresQueryable,
  context?: TransactionContext
): PostgresQueryable {
  return context instanceof PostgresTransactionContext ? context.client : pool;
}

