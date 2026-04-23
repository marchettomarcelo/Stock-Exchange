import { Module } from "@nestjs/common";

import type {
  Clock,
  Logger,
  PostgresPool,
  SymbolOrderBooks
} from "@decade/application";
import {
  PostgresOrderEventRepository,
  PostgresOrderRepository,
  PostgresProcessedCommandRepository,
  PostgresTradeRepository,
  PostgresTransactionManager,
  ProcessOrderCommand
} from "@decade/application";

import { ExpirationModule } from "../expiration/expiration.module";
import { RuntimeModule } from "../runtime/runtime.module";
import {
  CLOCK,
  LOGGER,
  POSTGRES_POOL,
  PROCESS_ORDER_COMMAND_USE_CASE,
  SYMBOL_ORDER_BOOKS
} from "../runtime/runtime.tokens";
import { ExchangeCommandsConsumer } from "./exchange-commands-consumer";

@Module({
  imports: [RuntimeModule, ExpirationModule],
  providers: [
    {
      provide: PROCESS_ORDER_COMMAND_USE_CASE,
      inject: [POSTGRES_POOL, CLOCK, SYMBOL_ORDER_BOOKS, LOGGER],
      useFactory: (
        pool: PostgresPool,
        clock: Clock,
        symbolBooks: SymbolOrderBooks,
        logger: Logger
      ): ProcessOrderCommand =>
        new ProcessOrderCommand({
          processedCommands: new PostgresProcessedCommandRepository(pool),
          orders: new PostgresOrderRepository(pool),
          trades: new PostgresTradeRepository(pool),
          orderEvents: new PostgresOrderEventRepository(pool),
          transactions: new PostgresTransactionManager(pool),
          clock,
          symbolBooks,
          logger
        })
    },
    ExchangeCommandsConsumer
  ]
})
export class EngineModule {}
