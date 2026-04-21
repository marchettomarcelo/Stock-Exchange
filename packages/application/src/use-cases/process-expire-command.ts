import type { ExpireOrderCommand } from "@decade/contracts";
import { expireOrderCommandSchema } from "@decade/contracts";
import { createOrderId, createSymbol, type IsoTimestamp, type OrderId, type Symbol } from "@decade/exchange-core";

import type {
  Clock,
  Logger,
  OrderEventRepository,
  OrderRepository,
  ProcessedCommandRepository,
  TransactionManager
} from "../index";
import { InvariantError } from "../errors";
import type { SymbolOrderBooks } from "../symbol-order-books";
import { createStateUpdateEvent } from "./helpers";

export interface ProcessExpireCommandDependencies {
  processedCommandRepository: ProcessedCommandRepository;
  orderRepository: OrderRepository;
  orderEventRepository: OrderEventRepository;
  transactionManager: TransactionManager;
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
  constructor(private readonly dependencies: ProcessExpireCommandDependencies) {}

  async execute(command: ExpireOrderCommand): Promise<ProcessExpireCommandResult> {
    const parsedCommand = expireOrderCommandSchema.parse(command);
    const orderId = createOrderId(parsedCommand.order_id);
    const symbol = createSymbol(parsedCommand.symbol);
    const processedAt = this.dependencies.clock.now();
    const existingMarker = await this.dependencies.processedCommandRepository.findByCommandId(
      parsedCommand.command_id
    );

    if (existingMarker !== null) {
      return {
        status: "duplicate",
        orderId: parsedCommand.order_id
      };
    }

    const order = await this.dependencies.orderRepository.findOrderById(orderId);

    if (order === null) {
      await this.dependencies.transactionManager.withTransaction(async (context) => {
        await this.dependencies.processedCommandRepository.markProcessed(
          {
            commandId: parsedCommand.command_id,
            commandType: parsedCommand.command_type,
            symbol,
            orderId: null,
            processedAt
          },
          context
        );
      });

      return {
        status: "skipped",
        orderId: parsedCommand.order_id,
        reason: "missing_order"
      };
    }

    if (new Date(order.validUntil).getTime() > new Date(processedAt).getTime()) {
      await this.markProcessedNoop(parsedCommand, order.orderId, processedAt);

      return {
        status: "skipped",
        orderId: parsedCommand.order_id,
        reason: "not_expired"
      };
    }

    if (order.status === "filled" || order.status === "expired") {
      await this.markProcessedNoop(parsedCommand, order.orderId, processedAt);

      return {
        status: "skipped",
        orderId: parsedCommand.order_id,
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

    await this.dependencies.transactionManager.withTransaction(async (context) => {
      await this.dependencies.orderRepository.updateOrder(updatedOrder, context);
      await this.dependencies.orderEventRepository.appendEvents(
        [
          createStateUpdateEvent({
            orderId: updatedOrder.orderId,
            status: updatedOrder.status,
            remainingQuantity: updatedOrder.remainingQuantity,
            commandId: parsedCommand.command_id,
            createdAt: processedAt
          })
        ],
        context
      );
      await this.dependencies.processedCommandRepository.markProcessed(
        {
          commandId: parsedCommand.command_id,
          commandType: parsedCommand.command_type,
          symbol,
          orderId: updatedOrder.orderId,
          processedAt
        },
        context
      );
    });

    this.dependencies.logger?.info("Order expired", {
      orderId: updatedOrder.orderId,
      symbol: updatedOrder.symbol
    });

    return {
      status: "expired",
      orderId: parsedCommand.order_id
    };
  }

  private async expireOpenOrder(orderId: OrderId, symbol: Symbol, processedAt: IsoTimestamp) {
    const book = await this.dependencies.symbolBooks.getOrCreate(symbol, async () =>
      this.dependencies.orderRepository.listRestingOrdersForSymbol(symbol)
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
    await this.dependencies.transactionManager.withTransaction(async (context) => {
      await this.dependencies.processedCommandRepository.markProcessed(
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
