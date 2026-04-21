import { Module } from "@nestjs/common";

import type {
  Clock,
  CommandPublisher,
  IdGenerator,
  LeaseManager,
  Logger,
  OrderEventRepository,
  OrderRepository,
  ProcessedCommandRepository,
  ScanForExpiredOrders,
  SymbolOrderBooks,
  TransactionManager
} from "@decade/application";
import {
  ProcessExpireCommand,
  ScanForExpiredOrders as ScanForExpiredOrdersUseCase
} from "@decade/application";
import type { AppConfig } from "@decade/infrastructure";

import { RuntimeModule } from "../runtime/runtime.module";
import {
  APP_CONFIG,
  CLOCK,
  COMMAND_PUBLISHER,
  ID_GENERATOR,
  LEASE_MANAGER,
  LOGGER,
  ORDER_EVENT_REPOSITORY,
  ORDER_REPOSITORY,
  PROCESS_EXPIRE_COMMAND_USE_CASE,
  PROCESSED_COMMAND_REPOSITORY,
  SCAN_EXPIRED_ORDERS_USE_CASE,
  SYMBOL_ORDER_BOOKS,
  TRANSACTION_MANAGER
} from "../runtime/runtime.tokens";
import { ExpirationScheduler } from "./expiration-scheduler";

@Module({
  imports: [RuntimeModule],
  providers: [
    {
      provide: PROCESS_EXPIRE_COMMAND_USE_CASE,
      inject: [
        PROCESSED_COMMAND_REPOSITORY,
        ORDER_REPOSITORY,
        ORDER_EVENT_REPOSITORY,
        TRANSACTION_MANAGER,
        CLOCK,
        SYMBOL_ORDER_BOOKS,
        LOGGER
      ],
      useFactory: (
        processedCommandRepository: ProcessedCommandRepository,
        orderRepository: OrderRepository,
        orderEventRepository: OrderEventRepository,
        transactionManager: TransactionManager,
        clock: Clock,
        symbolBooks: SymbolOrderBooks,
        logger: Logger
      ): ProcessExpireCommand =>
        new ProcessExpireCommand({
          processedCommandRepository,
          orderRepository,
          orderEventRepository,
          transactionManager,
          clock,
          symbolBooks,
          logger
        })
    },
    {
      provide: SCAN_EXPIRED_ORDERS_USE_CASE,
      inject: [
        LEASE_MANAGER,
        ORDER_REPOSITORY,
        COMMAND_PUBLISHER,
        ID_GENERATOR,
        CLOCK,
        APP_CONFIG,
        LOGGER
      ],
      useFactory: (
        leaseManager: LeaseManager,
        orderRepository: OrderRepository,
        commandPublisher: CommandPublisher,
        idGenerator: IdGenerator,
        clock: Clock,
        config: AppConfig,
        logger: Logger
      ): ScanForExpiredOrders =>
        new ScanForExpiredOrdersUseCase({
          leaseManager,
          orderRepository,
          commandPublisher,
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
