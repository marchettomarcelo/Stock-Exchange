import { Module } from "@nestjs/common";

import type {
  Clock,
  Logger,
  OrderEventRepository,
  OrderRepository,
  ProcessedCommandRepository,
  SymbolOrderBooks,
  TradeRepository,
  TransactionManager
} from "@decade/application";
import { ProcessOrderCommand } from "@decade/application";

import { ExpirationModule } from "../expiration/expiration.module";
import { RuntimeModule } from "../runtime/runtime.module";
import {
  CLOCK,
  LOGGER,
  ORDER_EVENT_REPOSITORY,
  ORDER_REPOSITORY,
  PROCESS_ORDER_COMMAND_USE_CASE,
  PROCESSED_COMMAND_REPOSITORY,
  SYMBOL_ORDER_BOOKS,
  TRADE_REPOSITORY,
  TRANSACTION_MANAGER
} from "../runtime/runtime.tokens";
import { ExchangeCommandsConsumer } from "./exchange-commands-consumer";

@Module({
  imports: [RuntimeModule, ExpirationModule],
  providers: [
    {
      provide: PROCESS_ORDER_COMMAND_USE_CASE,
      inject: [
        PROCESSED_COMMAND_REPOSITORY,
        ORDER_REPOSITORY,
        TRADE_REPOSITORY,
        ORDER_EVENT_REPOSITORY,
        TRANSACTION_MANAGER,
        CLOCK,
        SYMBOL_ORDER_BOOKS,
        LOGGER
      ],
      useFactory: (
        processedCommandRepository: ProcessedCommandRepository,
        orderRepository: OrderRepository,
        tradeRepository: TradeRepository,
        orderEventRepository: OrderEventRepository,
        transactionManager: TransactionManager,
        clock: Clock,
        symbolBooks: SymbolOrderBooks,
        logger: Logger
      ): ProcessOrderCommand =>
        new ProcessOrderCommand({
          processedCommandRepository,
          orderRepository,
          tradeRepository,
          orderEventRepository,
          transactionManager,
          clock,
          symbolBooks,
          logger
        })
    },
    ExchangeCommandsConsumer
  ]
})
export class EngineModule {}
