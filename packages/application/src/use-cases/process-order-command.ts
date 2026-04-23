import type { SubmitOrderCommand } from "@decade/contracts";
import {
  createBrokerId,
  createOrderId,
  createOwnerDocument,
  createPrice,
  createQuantity,
  createSymbol,
  createValidUntil,
  type OrderSnapshot
} from "@decade/exchange-core";

import type { PersistedOrderRecord } from "../records";
import { InvariantError, NotFoundError } from "../errors";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { PostgresOrderEventRepository } from "../postgres/postgres-order-event-repository";
import type { PostgresOrderRepository } from "../postgres/postgres-order-repository";
import type { PostgresProcessedCommandRepository } from "../postgres/postgres-processed-command-repository";
import type { PostgresTradeRepository } from "../postgres/postgres-trade-repository";
import type { PostgresTransactionContext } from "../postgres/postgres-types";
import type { PostgresTransactionManager } from "../postgres/postgres-transaction-manager";
import type { SymbolOrderBooks } from "../symbol-order-books";
import {
  createStateUpdateEvent,
  shouldKeepRestingSequence,
  toPersistedOrderRecord
} from "./helpers";

export interface ProcessOrderCommandServices {
  processedCommands: PostgresProcessedCommandRepository;
  orders: PostgresOrderRepository;
  trades: PostgresTradeRepository;
  orderEvents: PostgresOrderEventRepository;
  transactions: PostgresTransactionManager;
  clock: Clock;
  symbolBooks: SymbolOrderBooks;
  logger?: Logger;
}

export interface ProcessOrderCommandResult {
  status: "processed" | "duplicate";
  orderId: string;
  finalStatus?: OrderSnapshot["status"];
  trades?: number;
}

export class ProcessOrderCommand {
  constructor(private readonly services: ProcessOrderCommandServices) {}

  async execute(command: SubmitOrderCommand): Promise<ProcessOrderCommandResult> {
    const orderId = createOrderId(command.order_id);
    const symbol = createSymbol(command.symbol);
    const processedAt = this.services.clock.now();
    const existingMarker = await this.services.processedCommands.findByCommandId(
      command.command_id
    );

    if (existingMarker !== null) {
      return {
        status: "duplicate",
        orderId: command.order_id
      };
    }

    const persistedOrder = await this.services.orders.findOrderById(orderId);

    if (persistedOrder === null) {
      throw new NotFoundError(`Order ${command.order_id} was not found`);
    }

    const book = await this.services.symbolBooks.getOrCreate(
      symbol,
      async () => this.services.orders.listRestingOrdersForSymbol(symbol)
    );
    const matchResult = book.placeOrder(
      {
        orderId,
        brokerId: createBrokerId(command.broker_id),
        ownerDocument: createOwnerDocument(command.owner_document),
        symbol,
        side: command.side,
        price: createPrice(command.price),
        quantity: createQuantity(command.quantity),
        validUntil: createValidUntil(command.valid_until),
        acceptedAt: persistedOrder.acceptedAt
      },
      processedAt
    );

    await this.services.transactions.withTransaction(async (context) => {
      const updatedOrders = await Promise.all(
        matchResult.updates.map(async (snapshot) => {
          const currentRecord =
            snapshot.orderId === persistedOrder.orderId
              ? persistedOrder
              : await this.services.orders.findOrderById(snapshot.orderId, context);
          const restingSequence = await this.resolveRestingSequence(
            snapshot,
            currentRecord,
            context
          );
          const record = toPersistedOrderRecord({
            snapshot,
            updatedAt: processedAt,
            restingSequence
          });

          await this.services.orders.updateOrder(record, context);

          return record;
        })
      );

      await this.services.trades.appendTrades(
        matchResult.trades.map((trade) => ({
          symbol: trade.symbol,
          buyOrderId: trade.buyOrderId,
          sellOrderId: trade.sellOrderId,
          price: trade.price,
          quantity: trade.quantity,
          executedAt: trade.executedAt
        })),
        context
      );
      await this.services.orderEvents.appendEvents(
        updatedOrders.map((order) =>
          createStateUpdateEvent({
            orderId: order.orderId,
            status: order.status,
            remainingQuantity: order.remainingQuantity,
            commandId: command.command_id,
            createdAt: processedAt
          })
        ),
        context
      );
      await this.services.processedCommands.markProcessed(
        {
          commandId: command.command_id,
          commandType: command.command_type,
          symbol,
          orderId,
          processedAt
        },
        context
      );
    });

    this.services.logger?.info("Order command processed", {
      orderId: command.order_id,
      status: matchResult.order.status,
      trades: matchResult.trades.length
    });

    return {
      status: "processed",
      orderId: command.order_id,
      finalStatus: matchResult.order.status,
      trades: matchResult.trades.length
    };
  }

  private async resolveRestingSequence(
    snapshot: OrderSnapshot,
    currentRecord: PersistedOrderRecord | null,
    context: PostgresTransactionContext
  ): Promise<number | null> {
    if (!shouldKeepRestingSequence(snapshot.status)) {
      return null;
    }

    if (currentRecord?.restingSequence !== null && currentRecord?.restingSequence !== undefined) {
      return currentRecord.restingSequence;
    }

    if (currentRecord !== null && currentRecord.status !== "accepted") {
      throw new InvariantError(`Order ${snapshot.orderId} is missing a resting sequence`);
    }

    return this.services.orders.nextRestingSequence(context);
  }
}
