import type { Provider } from "@nestjs/common";

import type {
  Clock,
  IdGenerator,
  PostgresPool,
  RequestHasher
} from "@decade/application";
import {
  GetOrderStatus,
  PostgresIdempotencyRepository,
  PostgresOrderRepository,
  PostgresTransactionManager,
  SubmitOrder
} from "@decade/application";
import type { Logger } from "@decade/application";
import {
  type DisconnectablePublisher,
  JsonConsoleLogger,
  JsonRequestHasher,
  type AppConfig,
  SystemClock,
  SystemIdGenerator,
  createKafkaClient,
  createKafkaPublisher,
  createPostgresPool,
  loadAppConfig
} from "@decade/infrastructure";

import {
  APP_CONFIG,
  CLOCK,
  COMMAND_PUBLISHER,
  GET_ORDER_STATUS_USE_CASE,
  ID_GENERATOR,
  KAFKA_CLIENT,
  LOGGER,
  POSTGRES_POOL,
  REQUEST_HASHER,
  SUBMIT_ORDER_USE_CASE
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
      POSTGRES_POOL,
      COMMAND_PUBLISHER,
      ID_GENERATOR,
      REQUEST_HASHER,
      CLOCK,
      APP_CONFIG,
      LOGGER
    ],
    useFactory: (
      pool: PostgresPool,
      commandPublisher: DisconnectablePublisher,
      idGenerator: IdGenerator,
      requestHasher: RequestHasher,
      clock: Clock,
      config: AppConfig,
      logger: Logger
    ): SubmitOrder =>
      new SubmitOrder({
        orders: new PostgresOrderRepository(pool),
        idempotency: new PostgresIdempotencyRepository(pool),
        transactions: new PostgresTransactionManager(pool),
        commands: commandPublisher,
        idGenerator,
        requestHasher,
        clock,
        commandsTopic: config.kafka.commandsTopic,
        logger
      })
  },
  {
    provide: GET_ORDER_STATUS_USE_CASE,
    inject: [POSTGRES_POOL, LOGGER],
    useFactory: (pool: PostgresPool, logger: Logger): GetOrderStatus =>
      new GetOrderStatus({
        orders: new PostgresOrderRepository(pool),
        logger
      })
  },
  BrokerApiRuntime
];
