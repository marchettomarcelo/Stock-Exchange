import type { BrokerId, OrderId, Quantity, Symbol, ValidUntil } from "../primitives";
import type { IsoTimestamp, OwnerDocument, Price } from "../primitives";
import type { OrderSide } from "../order-side";
import type { OrderStatus } from "../order-status";
import { DomainValidationError } from "../errors";

export interface OrderInput {
  orderId: OrderId;
  brokerId: BrokerId;
  ownerDocument: OwnerDocument;
  symbol: Symbol;
  side: OrderSide;
  price: Price;
  quantity: Quantity;
  validUntil: ValidUntil;
  acceptedAt: IsoTimestamp;
}

export interface RestingOrder {
  orderId: OrderId;
  brokerId: BrokerId;
  ownerDocument: OwnerDocument;
  symbol: Symbol;
  side: OrderSide;
  price: Price;
  originalQuantity: number;
  remainingQuantity: number;
  validUntil: ValidUntil;
  acceptedAt: IsoTimestamp;
}

export interface RestoredOrderInput {
  orderId: OrderId;
  brokerId: BrokerId;
  ownerDocument: OwnerDocument;
  symbol: Symbol;
  side: OrderSide;
  price: Price;
  originalQuantity: number;
  remainingQuantity: number;
  validUntil: ValidUntil;
  acceptedAt: IsoTimestamp;
}

export interface OrderSnapshot {
  orderId: OrderId;
  brokerId: BrokerId;
  ownerDocument: OwnerDocument;
  symbol: Symbol;
  side: OrderSide;
  price: Price;
  originalQuantity: number;
  remainingQuantity: number;
  validUntil: ValidUntil;
  acceptedAt: IsoTimestamp;
  status: OrderStatus;
}

function ensureNonNegativeInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainValidationError(`${fieldName} must be a non-negative integer`);
  }

  return value;
}

export function createRestingOrder(input: OrderInput): RestingOrder {
  return {
    orderId: input.orderId,
    brokerId: input.brokerId,
    ownerDocument: input.ownerDocument,
    symbol: input.symbol,
    side: input.side,
    price: input.price,
    originalQuantity: ensureNonNegativeInteger(input.quantity, "quantity"),
    remainingQuantity: ensureNonNegativeInteger(input.quantity, "quantity"),
    validUntil: input.validUntil,
    acceptedAt: input.acceptedAt
  };
}

export function createRestoredOrder(input: RestoredOrderInput): RestingOrder {
  const originalQuantity = ensureNonNegativeInteger(
    input.originalQuantity,
    "original_quantity"
  );
  const remainingQuantity = ensureNonNegativeInteger(
    input.remainingQuantity,
    "remaining_quantity"
  );

  if (remainingQuantity === 0) {
    throw new DomainValidationError("remaining_quantity must be greater than zero for a live order");
  }

  if (remainingQuantity > originalQuantity) {
    throw new DomainValidationError("remaining_quantity must not exceed original_quantity");
  }

  return {
    orderId: input.orderId,
    brokerId: input.brokerId,
    ownerDocument: input.ownerDocument,
    symbol: input.symbol,
    side: input.side,
    price: input.price,
    originalQuantity,
    remainingQuantity,
    validUntil: input.validUntil,
    acceptedAt: input.acceptedAt
  };
}

export function isOrderExpired(validUntil: ValidUntil, processedAt: IsoTimestamp): boolean {
  return new Date(validUntil).getTime() <= new Date(processedAt).getTime();
}

export function getOrderStatus(
  originalQuantity: number,
  remainingQuantity: number
): Extract<OrderStatus, "open" | "partially_filled" | "filled"> {
  ensureNonNegativeInteger(originalQuantity, "original_quantity");
  ensureNonNegativeInteger(remainingQuantity, "remaining_quantity");

  if (remainingQuantity > originalQuantity) {
    throw new DomainValidationError("remaining_quantity must not exceed original_quantity");
  }

  if (remainingQuantity === 0) {
    return "filled";
  }

  if (remainingQuantity === originalQuantity) {
    return "open";
  }

  return "partially_filled";
}

export function toOrderSnapshot(order: RestingOrder): OrderSnapshot {
  return {
    orderId: order.orderId,
    brokerId: order.brokerId,
    ownerDocument: order.ownerDocument,
    symbol: order.symbol,
    side: order.side,
    price: order.price,
    originalQuantity: order.originalQuantity,
    remainingQuantity: order.remainingQuantity,
    validUntil: order.validUntil,
    acceptedAt: order.acceptedAt,
    status: getOrderStatus(order.originalQuantity, order.remainingQuantity)
  };
}

export function toExpiredOrderSnapshot(input: OrderInput): OrderSnapshot {
  return {
    orderId: input.orderId,
    brokerId: input.brokerId,
    ownerDocument: input.ownerDocument,
    symbol: input.symbol,
    side: input.side,
    price: input.price,
    originalQuantity: input.quantity,
    remainingQuantity: input.quantity,
    validUntil: input.validUntil,
    acceptedAt: input.acceptedAt,
    status: "expired"
  };
}

export function toExpiredRestingOrderSnapshot(order: RestingOrder): OrderSnapshot {
  return {
    orderId: order.orderId,
    brokerId: order.brokerId,
    ownerDocument: order.ownerDocument,
    symbol: order.symbol,
    side: order.side,
    price: order.price,
    originalQuantity: order.originalQuantity,
    remainingQuantity: order.remainingQuantity,
    validUntil: order.validUntil,
    acceptedAt: order.acceptedAt,
    status: "expired"
  };
}
