import {
  acceptedOrderResponseSchema,
  orderStatusResponseSchema,
  submitOrderCommandSchema,
  submitOrderRequestSchema,
  type AcceptedOrderResponse,
  type OrderStatusResponse,
  type SubmitOrderCommand,
  type SubmitOrderRequest
} from "@decade/contracts";
import {
  createBrokerId,
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

export function parseSubmitOrderRequest(request: SubmitOrderRequest): SubmitOrderRequest {
  return submitOrderRequestSchema.parse(request);
}

export function parseSubmitOrderCommand(command: SubmitOrderCommand): SubmitOrderCommand {
  return submitOrderCommandSchema.parse(command);
}

export function createAcceptedOrderRecord(input: {
  orderId: string;
  brokerId: string;
  request: SubmitOrderRequest;
  acceptedAt: IsoTimestamp;
}): PersistedOrderRecord {
  const parsedRequest = parseSubmitOrderRequest(input.request);

  return {
    orderId: createOrderId(input.orderId),
    brokerId: createBrokerId(input.brokerId),
    ownerDocument: createOwnerDocument(parsedRequest.owner_document),
    symbol: createSymbol(parsedRequest.symbol),
    side: parsedRequest.side,
    price: createPrice(parsedRequest.price),
    originalQuantity: createQuantity(parsedRequest.quantity),
    remainingQuantity: createQuantity(parsedRequest.quantity),
    status: "accepted",
    validUntil: createValidUntil(parsedRequest.valid_until),
    acceptedAt: input.acceptedAt,
    updatedAt: input.acceptedAt,
    restingSequence: null
  };
}

export function createSubmitOrderCommand(input: {
  commandId: string;
  orderId: OrderId;
  brokerId: string;
  request: SubmitOrderRequest;
  acceptedAt: IsoTimestamp;
}): SubmitOrderCommand {
  const parsedRequest = parseSubmitOrderRequest(input.request);

  return submitOrderCommandSchema.parse({
    command_id: input.commandId,
    command_type: "SubmitOrder",
    order_id: input.orderId,
    broker_id: input.brokerId,
    owner_document: parsedRequest.owner_document,
    side: parsedRequest.side,
    symbol: parsedRequest.symbol,
    price: parsedRequest.price,
    quantity: parsedRequest.quantity,
    valid_until: parsedRequest.valid_until,
    accepted_at: input.acceptedAt
  });
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
