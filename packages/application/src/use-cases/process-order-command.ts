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

import type {
  Clock,
  Logger,
  OrderEventRepository,
  OrderRepository,
  ProcessedCommandRepository,
  TradeRepository,
  TransactionManager
} from "../index";
import type { PersistedOrderRecord } from "../records";
import { InvariantError, NotFoundError } from "../errors";
import type { SymbolOrderBooks } from "../symbol-order-books";
import {
  createStateUpdateEvent,
  parseSubmitOrderCommand,
  shouldKeepRestingSequence,
  toPersistedOrderRecord
} from "./helpers";

export interface ProcessOrderCommandDependencies {
  processedCommandRepository: ProcessedCommandRepository;
  orderRepository: OrderRepository;
  tradeRepository: TradeRepository;
  orderEventRepository: OrderEventRepository;
  transactionManager: TransactionManager;
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
  constructor(private readonly dependencies: ProcessOrderCommandDependencies) {}

  async execute(command: SubmitOrderCommand): Promise<ProcessOrderCommandResult> {
    const parsedCommand = parseSubmitOrderCommand(command);
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

    const persistedOrder = await this.dependencies.orderRepository.findOrderById(orderId);

    if (persistedOrder === null) {
      throw new NotFoundError(`Order ${parsedCommand.order_id} was not found`);
    }

    const book = await this.dependencies.symbolBooks.getOrCreate(
      symbol,
      async () => this.dependencies.orderRepository.listRestingOrdersForSymbol(symbol)
    );
    const matchResult = book.placeOrder(
      {
        orderId,
        brokerId: createBrokerId(parsedCommand.broker_id),
        ownerDocument: createOwnerDocument(parsedCommand.owner_document),
        symbol,
        side: parsedCommand.side,
        price: createPrice(parsedCommand.price),
        quantity: createQuantity(parsedCommand.quantity),
        validUntil: createValidUntil(parsedCommand.valid_until),
        acceptedAt: persistedOrder.acceptedAt
      },
      processedAt
    );

    await this.dependencies.transactionManager.withTransaction(async (context) => {
      const updatedOrders = await Promise.all(
        matchResult.updates.map(async (snapshot) => {
          const currentRecord =
            snapshot.orderId === persistedOrder.orderId
              ? persistedOrder
              : await this.dependencies.orderRepository.findOrderById(snapshot.orderId, context);
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

          await this.dependencies.orderRepository.updateOrder(record, context);

          return record;
        })
      );

      await this.dependencies.tradeRepository.appendTrades(
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
      await this.dependencies.orderEventRepository.appendEvents(
        updatedOrders.map((order) =>
          createStateUpdateEvent({
            orderId: order.orderId,
            status: order.status,
            remainingQuantity: order.remainingQuantity,
            commandId: parsedCommand.command_id,
            createdAt: processedAt
          })
        ),
        context
      );
      await this.dependencies.processedCommandRepository.markProcessed(
        {
          commandId: parsedCommand.command_id,
          commandType: parsedCommand.command_type,
          symbol,
          orderId,
          processedAt
        },
        context
      );
    });

    this.dependencies.logger?.info("Order command processed", {
      orderId: parsedCommand.order_id,
      status: matchResult.order.status,
      trades: matchResult.trades.length
    });

    return {
      status: "processed",
      orderId: parsedCommand.order_id,
      finalStatus: matchResult.order.status,
      trades: matchResult.trades.length
    };
  }

  private async resolveRestingSequence(
    snapshot: OrderSnapshot,
    currentRecord: PersistedOrderRecord | null,
    context: unknown
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

    return this.dependencies.orderRepository.nextRestingSequence(context as never);
  }
}
