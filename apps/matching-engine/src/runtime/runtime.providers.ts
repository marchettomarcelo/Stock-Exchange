import type { Provider } from "@nestjs/common";

import type {
  Clock,
  IdGenerator,
  LeaseManager,
  Logger,
  OrderEventRepository,
  OrderRepository,
  ProcessedCommandRepository,
  TradeRepository,
  TransactionManager
} from "@decade/application";
import { SymbolOrderBooks } from "@decade/application";
import {
  JsonConsoleLogger,
  type AppConfig,
  type DisconnectablePublisher,
  PostgresAdvisoryLockManager,
  PostgresOrderEventRepository,
  PostgresOrderRepository,
  PostgresProcessedCommandRepository,
  PostgresTradeRepository,
  PostgresTransactionManager,
  SystemClock,
  SystemIdGenerator,
  createKafkaClient,
  createKafkaConsumer,
  createKafkaPublisher,
  createPostgresPool,
  loadAppConfig,
  type PostgresPool
} from "@decade/infrastructure";

import {
  APP_CONFIG,
  CLOCK,
  COMMAND_CONSUMER,
  COMMAND_PUBLISHER,
  ID_GENERATOR,
  KAFKA_CLIENT,
  LEASE_MANAGER,
  LOGGER,
  ORDER_EVENT_REPOSITORY,
  ORDER_REPOSITORY,
  POSTGRES_POOL,
  PROCESSED_COMMAND_REPOSITORY,
  SYMBOL_ORDER_BOOKS,
  TRADE_REPOSITORY,
  TRANSACTION_MANAGER
} from "./runtime.tokens";
import { MatchingEngineRuntime } from "./runtime.shutdown";

export const runtimeProviders: Provider[] = [
  {
    provide: APP_CONFIG,
    useFactory: (): AppConfig => {
      return loadAppConfig({
        ...process.env,
        SERVICE_NAME: process.env.SERVICE_NAME ?? "matching-engine"
      });
    }
  },
  {
    provide: LOGGER,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): Logger => {
      return new JsonConsoleLogger({
        serviceName: config.serviceName,
        level: config.logLevel
      });
    }
  },
  {
    provide: CLOCK,
    useFactory: (): Clock => new SystemClock()
  },
  {
    provide: ID_GENERATOR,
    useFactory: (): IdGenerator => new SystemIdGenerator()
  },
  {
    provide: POSTGRES_POOL,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): PostgresPool => createPostgresPool(config.database)
  },
  {
    provide: LEASE_MANAGER,
    inject: [POSTGRES_POOL],
    useFactory: (pool: PostgresPool): LeaseManager => new PostgresAdvisoryLockManager(pool)
  },
  {
    provide: ORDER_REPOSITORY,
    inject: [POSTGRES_POOL],
    useFactory: (pool: PostgresPool): OrderRepository => new PostgresOrderRepository(pool)
  },
  {
    provide: TRADE_REPOSITORY,
    inject: [POSTGRES_POOL],
    useFactory: (pool: PostgresPool): TradeRepository => new PostgresTradeRepository(pool)
  },
  {
    provide: ORDER_EVENT_REPOSITORY,
    inject: [POSTGRES_POOL],
    useFactory: (pool: PostgresPool): OrderEventRepository =>
      new PostgresOrderEventRepository(pool)
  },
  {
    provide: PROCESSED_COMMAND_REPOSITORY,
    inject: [POSTGRES_POOL],
    useFactory: (pool: PostgresPool): ProcessedCommandRepository =>
      new PostgresProcessedCommandRepository(pool)
  },
  {
    provide: TRANSACTION_MANAGER,
    inject: [POSTGRES_POOL],
    useFactory: (pool: PostgresPool): TransactionManager => new PostgresTransactionManager(pool)
  },
  {
    provide: SYMBOL_ORDER_BOOKS,
    useFactory: (): SymbolOrderBooks => new SymbolOrderBooks()
  },
  {
    provide: KAFKA_CLIENT,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig) => createKafkaClient(config.kafka)
  },
  {
    provide: COMMAND_CONSUMER,
    inject: [KAFKA_CLIENT],
    useFactory: (kafkaClient: Parameters<typeof createKafkaConsumer>[0]) =>
      createKafkaConsumer(kafkaClient)
  },
  {
    provide: COMMAND_PUBLISHER,
    inject: [KAFKA_CLIENT],
    useFactory: async (
      kafkaClient: Parameters<typeof createKafkaPublisher>[0]
    ): Promise<DisconnectablePublisher> => createKafkaPublisher(kafkaClient)
  },
  MatchingEngineRuntime
];
