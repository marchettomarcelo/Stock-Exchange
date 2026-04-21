import type {
  BrokerId,
  IsoTimestamp,
  OrderId,
  OrderStatus,
  OrderSide,
  OwnerDocument,
  Price,
  Symbol,
  ValidUntil
} from "@decade/exchange-core";

export interface PersistedOrderRecord {
  orderId: OrderId;
  brokerId: BrokerId;
  ownerDocument: OwnerDocument;
  symbol: Symbol;
  side: OrderSide;
  price: Price;
  originalQuantity: number;
  remainingQuantity: number;
  status: OrderStatus;
  validUntil: ValidUntil;
  acceptedAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  restingSequence: number | null;
}

export interface RecoveryOrderRecord extends PersistedOrderRecord {
  restingSequence: number;
}

export interface DueOrderRecord {
  orderId: OrderId;
  symbol: Symbol;
  validUntil: ValidUntil;
  status: OrderStatus;
}

export interface TradeRecord {
  tradeId?: number;
  symbol: Symbol;
  buyOrderId: OrderId;
  sellOrderId: OrderId;
  price: Price;
  quantity: number;
  executedAt: IsoTimestamp;
}

export interface OrderEventRecord {
  eventId?: number;
  orderId: OrderId;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: IsoTimestamp;
}

export interface IdempotencyRecord {
  brokerId: BrokerId;
  idempotencyKey: string;
  orderId: OrderId;
  requestHash: string;
  createdAt: IsoTimestamp;
}

export interface ProcessedCommandRecord {
  commandId: string;
  commandType: string;
  symbol: Symbol;
  orderId: OrderId | null;
  processedAt: IsoTimestamp;
}

