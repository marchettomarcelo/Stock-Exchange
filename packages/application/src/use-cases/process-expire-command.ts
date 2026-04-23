import type { ExpireOrderCommand } from "@decade/contracts";
import { createOrderId, createSymbol, type IsoTimestamp, type OrderId, type Symbol } from "@decade/exchange-core";

import { InvariantError } from "../errors";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { PostgresOrderEventRepository } from "../postgres/postgres-order-event-repository";
import type { PostgresOrderRepository } from "../postgres/postgres-order-repository";
import type { PostgresProcessedCommandRepository } from "../postgres/postgres-processed-command-repository";
import type { PostgresTransactionManager } from "../postgres/postgres-transaction-manager";
import type { SymbolOrderBooks } from "../symbol-order-books";
import { createStateUpdateEvent } from "./helpers";

export interface ProcessExpireCommandServices {
  processedCommands: PostgresProcessedCommandRepository;
  orders: PostgresOrderRepository;
  orderEvents: PostgresOrderEventRepository;
  transactions: PostgresTransactionManager;
  clock: Clock;
  symbolBooks: SymbolOrderBooks;
  logger?: Logger;
}

export interface ProcessExpireCommandResult {
  status: "expired" | "duplicate" | "skipped";
  orderId: string;
  reason?: string;
}

export class ProcessExpireCommand {
  constructor(private readonly services: ProcessExpireCommandServices) {}

  async execute(command: ExpireOrderCommand): Promise<ProcessExpireCommandResult> {
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

    const order = await this.services.orders.findOrderById(orderId);

    if (order === null) {
      await this.services.transactions.withTransaction(async (context) => {
        await this.services.processedCommands.markProcessed(
          {
            commandId: command.command_id,
            commandType: command.command_type,
            symbol,
            orderId: null,
            processedAt
          },
          context
        );
      });

      return {
        status: "skipped",
        orderId: command.order_id,
        reason: "missing_order"
      };
    }

    if (new Date(order.validUntil).getTime() > new Date(processedAt).getTime()) {
      await this.markProcessedNoop(command, order.orderId, processedAt);

      return {
        status: "skipped",
        orderId: command.order_id,
        reason: "not_expired"
      };
    }

    if (order.status === "filled" || order.status === "expired") {
      await this.markProcessedNoop(command, order.orderId, processedAt);

      return {
        status: "skipped",
        orderId: command.order_id,
        reason: `already_${order.status}`
      };
    }

    const updatedOrder =
      order.status === "accepted"
        ? {
            ...order,
            status: "expired" as const,
            updatedAt: processedAt,
            restingSequence: null
          }
        : await this.expireOpenOrder(order.orderId, order.symbol, processedAt);

    await this.services.transactions.withTransaction(async (context) => {
      await this.services.orders.updateOrder(updatedOrder, context);
      await this.services.orderEvents.appendEvents(
        [
          createStateUpdateEvent({
            orderId: updatedOrder.orderId,
            status: updatedOrder.status,
            remainingQuantity: updatedOrder.remainingQuantity,
            commandId: command.command_id,
            createdAt: processedAt
          })
        ],
        context
      );
      await this.services.processedCommands.markProcessed(
        {
          commandId: command.command_id,
          commandType: command.command_type,
          symbol,
          orderId: updatedOrder.orderId,
          processedAt
        },
        context
      );
    });

    this.services.logger?.info("Order expired", {
      orderId: updatedOrder.orderId,
      symbol: updatedOrder.symbol
    });

    return {
      status: "expired",
      orderId: command.order_id
    };
  }

  private async expireOpenOrder(orderId: OrderId, symbol: Symbol, processedAt: IsoTimestamp) {
    const book = await this.services.symbolBooks.getOrCreate(symbol, async () =>
      this.services.orders.listRestingOrdersForSymbol(symbol)
    );
    const expiredSnapshot = book.expireOrder(orderId, processedAt);

    if (expiredSnapshot === null) {
      throw new InvariantError(`Order ${orderId} could not be expired from the live book`);
    }

    return {
      orderId: expiredSnapshot.orderId,
      brokerId: expiredSnapshot.brokerId,
      ownerDocument: expiredSnapshot.ownerDocument,
      symbol: expiredSnapshot.symbol,
      side: expiredSnapshot.side,
      price: expiredSnapshot.price,
      originalQuantity: expiredSnapshot.originalQuantity,
      remainingQuantity: expiredSnapshot.remainingQuantity,
      status: expiredSnapshot.status,
      validUntil: expiredSnapshot.validUntil,
      acceptedAt: expiredSnapshot.acceptedAt,
      updatedAt: processedAt,
      restingSequence: null
    };
  }

  private async markProcessedNoop(
    command: ExpireOrderCommand,
    orderId: OrderId | null,
    processedAt: IsoTimestamp
  ): Promise<void> {
    await this.services.transactions.withTransaction(async (context) => {
      await this.services.processedCommands.markProcessed(
        {
          commandId: command.command_id,
          commandType: command.command_type,
          symbol: createSymbol(command.symbol),
          orderId,
          processedAt
        },
        context
      );
    });
  }
}
