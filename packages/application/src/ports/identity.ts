export interface IdGenerator {
  nextOrderId(): string;
  nextCommandId(): string;
}

export interface RequestHasher {
  hash(value: unknown): string;
}

