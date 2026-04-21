import type { Provider } from "@nestjs/common";

import { GetOrderStatus, SubmitOrder } from "@decade/application";
import type {
  Clock,
  CommandPublisher,
  IdGenerator,
  IdempotencyRepository,
  Logger,
  OrderRepository,
  RequestHasher,
  TransactionManager
} from "@decade/application";
import {
  JsonConsoleLogger,
  JsonRequestHasher,
  type AppConfig,
  type DisconnectablePublisher,
  PostgresIdempotencyRepository,
  PostgresOrderRepository,
  PostgresTransactionManager,
  SystemClock,
  SystemIdGenerator,
  createKafkaClient,
  createKafkaPublisher,
  createPostgresPool,
  loadAppConfig,
  type PostgresPool
} from "@decade/infrastructure";

import {
  APP_CONFIG,
  CLOCK,
  COMMAND_PUBLISHER,
  GET_ORDER_STATUS_USE_CASE,
  IDEMPOTENCY_REPOSITORY,
  ID_GENERATOR,
  KAFKA_CLIENT,
  LOGGER,
  ORDER_REPOSITORY,
  POSTGRES_POOL,
  REQUEST_HASHER,
  SUBMIT_ORDER_USE_CASE,
  TRANSACTION_MANAGER
} from "./runtime.tokens";
import { BrokerApiRuntime } from "./runtime.shutdown";

export const runtimeProviders: Provider[] = [
  {
    provide: APP_CONFIG,
    useFactory: (): AppConfig => {
      return loadAppConfig({
        ...process.env,
        SERVICE_NAME: process.env.SERVICE_NAME ?? "broker-api"
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
    provide: REQUEST_HASHER,
    useFactory: (): RequestHasher => new JsonRequestHasher()
  },
  {
    provide: POSTGRES_POOL,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): PostgresPool => createPostgresPool(config.database)
  },
  {
    provide: ORDER_REPOSITORY,
    inject: [POSTGRES_POOL],
    useFactory: (pool: PostgresPool): OrderRepository => new PostgresOrderRepository(pool)
  },
  {
    provide: IDEMPOTENCY_REPOSITORY,
    inject: [POSTGRES_POOL],
    useFactory: (pool: PostgresPool): IdempotencyRepository =>
      new PostgresIdempotencyRepository(pool)
  },
  {
    provide: TRANSACTION_MANAGER,
    inject: [POSTGRES_POOL],
    useFactory: (pool: PostgresPool): TransactionManager => new PostgresTransactionManager(pool)
  },
  {
    provide: KAFKA_CLIENT,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig) => createKafkaClient(config.kafka)
  },
  {
    provide: COMMAND_PUBLISHER,
    inject: [KAFKA_CLIENT],
    useFactory: async (
      kafkaClient: Parameters<typeof createKafkaPublisher>[0]
    ): Promise<DisconnectablePublisher> => createKafkaPublisher(kafkaClient)
  },
  {
    provide: SUBMIT_ORDER_USE_CASE,
    inject: [
      ORDER_REPOSITORY,
      IDEMPOTENCY_REPOSITORY,
      TRANSACTION_MANAGER,
      COMMAND_PUBLISHER,
      ID_GENERATOR,
      REQUEST_HASHER,
      CLOCK,
      APP_CONFIG,
      LOGGER
    ],
    useFactory: (
      orderRepository: OrderRepository,
      idempotencyRepository: IdempotencyRepository,
      transactionManager: TransactionManager,
      commandPublisher: CommandPublisher,
      idGenerator: IdGenerator,
      requestHasher: RequestHasher,
      clock: Clock,
      config: AppConfig,
      logger: Logger
    ): SubmitOrder =>
      new SubmitOrder({
        brokerId: process.env.BROKER_ID ?? "broker-api",
        orderRepository,
        idempotencyRepository,
        transactionManager,
        commandPublisher,
        idGenerator,
        requestHasher,
        clock,
        commandsTopic: config.kafka.commandsTopic,
        logger
      })
  },
  {
    provide: GET_ORDER_STATUS_USE_CASE,
    inject: [ORDER_REPOSITORY, LOGGER],
    useFactory: (orderRepository: OrderRepository, logger: Logger): GetOrderStatus =>
      new GetOrderStatus({
        orderRepository,
        logger
      })
  },
  BrokerApiRuntime
];
