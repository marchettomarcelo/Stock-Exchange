import { Module } from "@nestjs/common";

import type {
  Clock,
  IdGenerator,
  PostgresPool,
  ScanForExpiredOrders,
  SymbolOrderBooks
} from "@decade/application";
import {
  PostgresAdvisoryLockManager,
  PostgresOrderEventRepository,
  PostgresOrderRepository,
  PostgresProcessedCommandRepository,
  PostgresTransactionManager,
  ProcessExpireCommand,
  ScanForExpiredOrders as ScanForExpiredOrdersUseCase
} from "@decade/application";
import type { Logger } from "@decade/application";
import type { AppConfig, DisconnectablePublisher } from "@decade/infrastructure";

import { RuntimeModule } from "../runtime/runtime.module";
import {
  APP_CONFIG,
  CLOCK,
  COMMAND_PUBLISHER,
  ID_GENERATOR,
  LOGGER,
  POSTGRES_POOL,
  PROCESS_EXPIRE_COMMAND_USE_CASE,
  SCAN_EXPIRED_ORDERS_USE_CASE,
  SYMBOL_ORDER_BOOKS
} from "../runtime/runtime.tokens";
import { ExpirationScheduler } from "./expiration-scheduler";

@Module({
  imports: [RuntimeModule],
  providers: [
    {
      provide: PROCESS_EXPIRE_COMMAND_USE_CASE,
      inject: [POSTGRES_POOL, CLOCK, SYMBOL_ORDER_BOOKS, LOGGER],
      useFactory: (
        pool: PostgresPool,
        clock: Clock,
        symbolBooks: SymbolOrderBooks,
        logger: Logger
      ): ProcessExpireCommand =>
        new ProcessExpireCommand({
          processedCommands: new PostgresProcessedCommandRepository(pool),
          orders: new PostgresOrderRepository(pool),
          orderEvents: new PostgresOrderEventRepository(pool),
          transactions: new PostgresTransactionManager(pool),
          clock,
          symbolBooks,
          logger
        })
    },
    {
      provide: SCAN_EXPIRED_ORDERS_USE_CASE,
      inject: [POSTGRES_POOL, COMMAND_PUBLISHER, ID_GENERATOR, CLOCK, APP_CONFIG, LOGGER],
      useFactory: (
        pool: PostgresPool,
        commandPublisher: DisconnectablePublisher,
        idGenerator: IdGenerator,
        clock: Clock,
        config: AppConfig,
        logger: Logger
      ): ScanForExpiredOrders =>
        new ScanForExpiredOrdersUseCase({
          leaseManager: new PostgresAdvisoryLockManager(pool),
          orders: new PostgresOrderRepository(pool),
          commands: commandPublisher,
          idGenerator,
          clock,
          commandsTopic: config.kafka.commandsTopic,
          limit: config.expiration.scanLimit,
          leaseName: config.expiration.leaseName,
          logger
        })
    },
    ExpirationScheduler
  ],
  exports: [PROCESS_EXPIRE_COMMAND_USE_CASE, SCAN_EXPIRED_ORDERS_USE_CASE]
})
export class ExpirationModule {}
