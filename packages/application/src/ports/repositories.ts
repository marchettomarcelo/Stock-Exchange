import type { BrokerId, IsoTimestamp, OrderId, Symbol } from "@decade/exchange-core";

import type {
  DueOrderRecord,
  IdempotencyRecord,
  OrderEventRecord,
  PersistedOrderRecord,
  ProcessedCommandRecord,
  RecoveryOrderRecord,
  TradeRecord
} from "../records";
import type { TransactionContext } from "./transactions";

export interface OrderRepository {
  createAcceptedOrder(
    order: PersistedOrderRecord,
    context?: TransactionContext
  ): Promise<void>;
  updateOrder(order: PersistedOrderRecord, context?: TransactionContext): Promise<void>;
  findOrderById(
    orderId: OrderId,
    context?: TransactionContext
  ): Promise<PersistedOrderRecord | null>;
  listRestingOrdersForSymbol(
    symbol: Symbol,
    context?: TransactionContext
  ): Promise<RecoveryOrderRecord[]>;
  listDueOrders(
    asOf: IsoTimestamp,
    limit: number,
    context?: TransactionContext
  ): Promise<DueOrderRecord[]>;
  nextRestingSequence(context?: TransactionContext): Promise<number>;
}

export interface TradeRepository {
  appendTrades(trades: TradeRecord[], context?: TransactionContext): Promise<void>;
  listTradesForOrder(orderId: OrderId, context?: TransactionContext): Promise<TradeRecord[]>;
}

export interface OrderEventRepository {
  appendEvents(events: OrderEventRecord[], context?: TransactionContext): Promise<void>;
  listEventsForOrder(
    orderId: OrderId,
    context?: TransactionContext
  ): Promise<OrderEventRecord[]>;
}

export interface IdempotencyRepository {
  create(record: IdempotencyRecord, context?: TransactionContext): Promise<void>;
  findByBrokerAndKey(
    brokerId: BrokerId,
    idempotencyKey: string,
    context?: TransactionContext
  ): Promise<IdempotencyRecord | null>;
}

export interface ProcessedCommandRepository {
  markProcessed(
    record: ProcessedCommandRecord,
    context?: TransactionContext
  ): Promise<void>;
  findByCommandId(
    commandId: string,
    context?: TransactionContext
  ): Promise<ProcessedCommandRecord | null>;
}

