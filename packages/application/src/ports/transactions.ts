export interface TransactionContext {
  readonly kind: "transaction";
}

export interface TransactionManager {
  withTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}

