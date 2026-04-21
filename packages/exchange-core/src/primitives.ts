import { isoTimestampPattern, symbolPattern } from "./constants";
import type { Brand } from "./brand";
import { DomainValidationError } from "./errors";

export type OrderId = Brand<string, "OrderId">;
export type BrokerId = Brand<string, "BrokerId">;
export type OwnerDocument = Brand<string, "OwnerDocument">;
export type Symbol = Brand<string, "Symbol">;
export type Price = Brand<number, "Price">;
export type Quantity = Brand<number, "Quantity">;
export type IsoTimestamp = Brand<string, "IsoTimestamp">;
export type ValidUntil = Brand<string, "ValidUntil">;

function ensureNonEmptyString(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new DomainValidationError(`${fieldName} must not be empty`);
  }

  return trimmed;
}

function ensurePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainValidationError(`${fieldName} must be a positive integer`);
  }

  return value;
}

function ensureIsoTimestamp(value: string, fieldName: string): string {
  const trimmed = ensureNonEmptyString(value, fieldName);

  if (!isoTimestampPattern.test(trimmed)) {
    throw new DomainValidationError(`${fieldName} must be a valid ISO-8601 timestamp`);
  }

  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    throw new DomainValidationError(`${fieldName} must be a valid ISO-8601 timestamp`);
  }

  return date.toISOString();
}

export function createIsoTimestamp(value: string, fieldName = "timestamp"): IsoTimestamp {
  return ensureIsoTimestamp(value, fieldName) as IsoTimestamp;
}

export function createOrderId(value: string): OrderId {
  return ensureNonEmptyString(value, "order_id") as OrderId;
}

export function createBrokerId(value: string): BrokerId {
  return ensureNonEmptyString(value, "broker_id") as BrokerId;
}

export function createOwnerDocument(value: string): OwnerDocument {
  return ensureNonEmptyString(value, "owner_document") as OwnerDocument;
}

export function createSymbol(value: string): Symbol {
  const trimmed = ensureNonEmptyString(value, "symbol");

  if (!symbolPattern.test(trimmed)) {
    throw new DomainValidationError(
      "symbol must be uppercase and may only contain letters, numbers, dots, or dashes"
    );
  }

  return trimmed as Symbol;
}

export function createPrice(value: number): Price {
  return ensurePositiveInteger(value, "price") as Price;
}

export function createQuantity(value: number): Quantity {
  return ensurePositiveInteger(value, "quantity") as Quantity;
}

export function createValidUntil(value: string): ValidUntil {
  return createIsoTimestamp(value, "valid_until") as unknown as ValidUntil;
}
