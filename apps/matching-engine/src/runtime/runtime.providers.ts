import type { Provider } from "@nestjs/common";

import type {
  Clock,
  IdGenerator,
  KafkaCommandConsumer,
  PostgresPool
} from "@decade/application";
import { SymbolOrderBooks } from "@decade/application";
import type { Logger } from "@decade/application";
import {
  type DisconnectablePublisher,
  JsonConsoleLogger,
  type AppConfig,
  SystemClock,
  SystemIdGenerator,
  createKafkaClient,
  createKafkaConsumer,
  createKafkaPublisher,
  createPostgresPool,
  loadAppConfig
} from "@decade/infrastructure";

import {
  APP_CONFIG,
  CLOCK,
  COMMAND_CONSUMER,
  COMMAND_PUBLISHER,
  ID_GENERATOR,
  KAFKA_CLIENT,
  LOGGER,
  POSTGRES_POOL,
  SYMBOL_ORDER_BOOKS
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
    useFactory: (kafkaClient: Parameters<typeof createKafkaConsumer>[0]): KafkaCommandConsumer =>
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
