import {
  createBrokerId,
  createIsoTimestamp,
  createOrderId,
  createOwnerDocument,
  createPrice,
  createSymbol,
  createValidUntil,
  isOrderSide,
  isOrderStatus,
  type OrderSide,
  type OrderStatus
} from "@decade/exchange-core";

import type {
  DueOrderRecord,
  IdempotencyPublishStatus,
  IdempotencyRecord,
  OrderEventRecord,
  PersistedOrderRecord,
  ProcessedCommandRecord,
  RecoveryOrderRecord,
  TradeRecord
} from "../records";
import type { PostgresQueryRow } from "./postgres-types";

function toRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value;
}

function toIso(value: unknown, fieldName: string) {
  if (value instanceof Date) {
    return createIsoTimestamp(value.toISOString(), fieldName);
  }

  return createIsoTimestamp(toRequiredString(value, fieldName), fieldName);
}

function toInteger(value: unknown, fieldName: string): number {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(numeric)) {
    throw new Error(`${fieldName} must be an integer`);
  }

  return numeric;
}

function toNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toInteger(value, "integer");
}

function toOrderSide(value: unknown): OrderSide {
  const side = toRequiredString(value, "side");

  if (!isOrderSide(side)) {
    throw new Error(`Unsupported order side: ${side}`);
  }

  return side;
}

function toOrderStatus(value: unknown): OrderStatus {
  const status = toRequiredString(value, "status");

  if (!isOrderStatus(status)) {
    throw new Error(`Unsupported order status: ${status}`);
  }

  return status;
}

function toIdempotencyPublishStatus(value: unknown): IdempotencyPublishStatus {
  const status = toRequiredString(value, "publish_status");

  if (status !== "pending" && status !== "published") {
    throw new Error(`Unsupported idempotency publish status: ${status}`);
  }

  return status;
}

export function mapOrderRow(row: PostgresQueryRow): PersistedOrderRecord {
  return {
    orderId: createOrderId(toRequiredString(row.order_id, "order_id")),
    brokerId: createBrokerId(toRequiredString(row.broker_id, "broker_id")),
    ownerDocument: createOwnerDocument(toRequiredString(row.owner_document, "owner_document")),
    symbol: createSymbol(toRequiredString(row.symbol, "symbol")),
    side: toOrderSide(row.side),
    price: createPrice(toInteger(row.price, "price")),
    originalQuantity: toInteger(row.original_quantity, "original_quantity"),
    remainingQuantity: toInteger(row.remaining_quantity, "remaining_quantity"),
    status: toOrderStatus(row.status),
    validUntil: createValidUntil(toIso(row.valid_until, "valid_until")),
    acceptedAt: toIso(row.accepted_at, "accepted_at"),
    updatedAt: toIso(row.updated_at, "updated_at"),
    restingSequence: toNullableInteger(row.resting_sequence)
  };
}

export function mapRecoveryOrderRow(row: PostgresQueryRow): RecoveryOrderRecord {
  const order = mapOrderRow(row);

  if (order.restingSequence === null) {
    throw new Error("recovery order row is missing resting_sequence");
  }

  return {
    ...order,
    restingSequence: order.restingSequence
  };
}

export function mapDueOrderRow(row: PostgresQueryRow): DueOrderRecord {
  return {
    orderId: createOrderId(toRequiredString(row.order_id, "order_id")),
    symbol: createSymbol(toRequiredString(row.symbol, "symbol")),
    validUntil: createValidUntil(toIso(row.valid_until, "valid_until")),
    status: toOrderStatus(row.status)
  };
}

export function mapTradeRow(row: PostgresQueryRow): TradeRecord {
  return {
    tradeId: toInteger(row.trade_id, "trade_id"),
    symbol: createSymbol(toRequiredString(row.symbol, "symbol")),
    buyOrderId: createOrderId(toRequiredString(row.buy_order_id, "buy_order_id")),
    sellOrderId: createOrderId(toRequiredString(row.sell_order_id, "sell_order_id")),
    price: createPrice(toInteger(row.price, "price")),
    quantity: toInteger(row.quantity, "quantity"),
    executedAt: toIso(row.executed_at, "executed_at")
  };
}

export function mapOrderEventRow(row: PostgresQueryRow): OrderEventRecord {
  return {
    eventId: toInteger(row.event_id, "event_id"),
    orderId: createOrderId(toRequiredString(row.order_id, "order_id")),
    eventType: toRequiredString(row.event_type, "event_type"),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: toIso(row.created_at, "created_at")
  };
}

export function mapIdempotencyRow(row: PostgresQueryRow): IdempotencyRecord {
  return {
    brokerId: createBrokerId(toRequiredString(row.broker_id, "broker_id")),
    idempotencyKey: toRequiredString(row.idempotency_key, "idempotency_key"),
    orderId: createOrderId(toRequiredString(row.order_id, "order_id")),
    commandId: toRequiredString(row.command_id, "command_id"),
    symbol: createSymbol(toRequiredString(row.symbol, "symbol")),
    requestHash: toRequiredString(row.request_hash, "request_hash"),
    publishStatus: toIdempotencyPublishStatus(row.publish_status),
    createdAt: toIso(row.created_at, "created_at"),
    publishedAt:
      row.published_at === null || row.published_at === undefined
        ? null
        : toIso(row.published_at, "published_at")
  };
}

export function mapProcessedCommandRow(row: PostgresQueryRow): ProcessedCommandRecord {
  return {
    commandId: toRequiredString(row.command_id, "command_id"),
    commandType: toRequiredString(row.command_type, "command_type"),
    symbol: createSymbol(toRequiredString(row.symbol, "symbol")),
    orderId:
      row.order_id === null || row.order_id === undefined
        ? null
        : createOrderId(toRequiredString(row.order_id, "order_id")),
    processedAt: toIso(row.processed_at, "processed_at")
  };
}
