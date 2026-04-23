import {
  acceptedOrderResponseSchema,
  orderStatusResponseSchema,
  submitOrderRequestSchema,
  type AcceptedOrderResponse,
  type OrderStatusResponse,
  type SubmitOrderCommand,
  type SubmitOrderRequest
} from "@decade/contracts";
import {
  createBrokerId,
  createIsoTimestamp,
  createOrderId,
  createOwnerDocument,
  createPrice,
  createQuantity,
  createSymbol,
  createValidUntil,
  type IsoTimestamp,
  type OrderId,
  type OrderSnapshot,
  type OrderStatus
} from "@decade/exchange-core";

import type { PersistedOrderRecord } from "../records";
import type { IdempotencyRecord } from "../records";

export function parseSubmitOrderRequest(request: unknown): SubmitOrderRequest {
  return submitOrderRequestSchema.parse(request);
}

export function createAcceptedOrderRecord(input: {
  orderId: string;
  request: SubmitOrderRequest;
  acceptedAt: IsoTimestamp;
}): PersistedOrderRecord {
  return {
    orderId: createOrderId(input.orderId),
    brokerId: createBrokerId(input.request.broker_id),
    ownerDocument: createOwnerDocument(input.request.owner_document),
    symbol: createSymbol(input.request.symbol),
    side: input.request.side,
    price: createPrice(input.request.price),
    originalQuantity: createQuantity(input.request.quantity),
    remainingQuantity: createQuantity(input.request.quantity),
    status: "accepted",
    validUntil: createValidUntil(input.request.valid_until),
    acceptedAt: input.acceptedAt,
    updatedAt: input.acceptedAt,
    restingSequence: null
  };
}

export function createSubmitOrderCommand(input: {
  commandId: string;
  orderId: OrderId;
  request: SubmitOrderRequest;
  acceptedAt: IsoTimestamp;
}): SubmitOrderCommand {
  return {
    command_id: input.commandId,
    command_type: "SubmitOrder",
    order_id: input.orderId,
    broker_id: input.request.broker_id,
    owner_document: input.request.owner_document,
    side: input.request.side,
    symbol: input.request.symbol,
    price: input.request.price,
    quantity: input.request.quantity,
    valid_until: input.request.valid_until,
    accepted_at: input.acceptedAt
  };
}

export function createIdempotencyRecord(input: {
  brokerId: string;
  idempotencyKey: string;
  order: PersistedOrderRecord;
  commandId: string;
  requestHash: string;
  createdAt: IsoTimestamp;
}): IdempotencyRecord {
  return {
    brokerId: createBrokerId(input.brokerId),
    idempotencyKey: input.idempotencyKey,
    orderId: input.order.orderId,
    commandId: input.commandId,
    symbol: input.order.symbol,
    requestHash: input.requestHash,
    publishStatus: "pending",
    createdAt: input.createdAt,
    publishedAt: null
  };
}

export function recreateSubmitOrderCommand(
  order: PersistedOrderRecord,
  idempotency: Pick<IdempotencyRecord, "commandId">
): SubmitOrderCommand {
  return {
    command_id: idempotency.commandId,
    command_type: "SubmitOrder",
    order_id: order.orderId,
    broker_id: order.brokerId,
    owner_document: order.ownerDocument,
    side: order.side,
    symbol: order.symbol,
    price: order.price,
    quantity: order.originalQuantity,
    valid_until: order.validUntil,
    accepted_at: createIsoTimestamp(order.acceptedAt)
  };
}

export function toAcceptedOrderResponse(order: PersistedOrderRecord): AcceptedOrderResponse {
  return acceptedOrderResponseSchema.parse({
    order_id: order.orderId,
    status: "accepted",
    accepted_at: order.acceptedAt
  });
}

export function toOrderStatusResponse(order: PersistedOrderRecord): OrderStatusResponse {
  return orderStatusResponseSchema.parse({
    order_id: order.orderId,
    broker_id: order.brokerId,
    owner_document: order.ownerDocument,
    side: order.side,
    symbol: order.symbol,
    price: order.price,
    original_quantity: order.originalQuantity,
    remaining_quantity: order.remainingQuantity,
    status: order.status,
    valid_until: order.validUntil,
    accepted_at: order.acceptedAt,
    updated_at: order.updatedAt
  });
}

export function toPersistedOrderRecord(input: {
  snapshot: OrderSnapshot;
  updatedAt: IsoTimestamp;
  restingSequence: number | null;
}): PersistedOrderRecord {
  return {
    orderId: input.snapshot.orderId,
    brokerId: input.snapshot.brokerId,
    ownerDocument: input.snapshot.ownerDocument,
    symbol: input.snapshot.symbol,
    side: input.snapshot.side,
    price: input.snapshot.price,
    originalQuantity: input.snapshot.originalQuantity,
    remainingQuantity: input.snapshot.remainingQuantity,
    status: input.snapshot.status,
    validUntil: input.snapshot.validUntil,
    acceptedAt: input.snapshot.acceptedAt,
    updatedAt: input.updatedAt,
    restingSequence: input.restingSequence
  };
}

export function shouldKeepRestingSequence(status: OrderStatus): boolean {
  return status === "open" || status === "partially_filled";
}

export function createStateUpdateEvent(input: {
  orderId: OrderId;
  status: OrderStatus;
  remainingQuantity: number;
  commandId: string;
  createdAt: IsoTimestamp;
}): {
  orderId: OrderId;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: IsoTimestamp;
} {
  return {
    orderId: input.orderId,
    eventType: `order_${input.status}`,
    payload: {
      status: input.status,
      remaining_quantity: input.remainingQuantity,
      command_id: input.commandId
    },
    createdAt: input.createdAt
  };
}
