import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";

import type {
  ConsumedCommand,
  KafkaCommandConsumer,
  Logger,
  ProcessExpireCommand,
  ProcessExpireCommandResult,
  ProcessOrderCommand,
  ProcessOrderCommandResult
} from "@decade/application";
import type { AppConfig } from "@decade/infrastructure";

import {
  APP_CONFIG,
  COMMAND_CONSUMER,
  LOGGER,
  PROCESS_EXPIRE_COMMAND_USE_CASE,
  PROCESS_ORDER_COMMAND_USE_CASE
} from "../runtime/runtime.tokens";

@Injectable()
export class ExchangeCommandsConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Inject(COMMAND_CONSUMER) private readonly commandConsumer: KafkaCommandConsumer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_ORDER_COMMAND_USE_CASE)
    private readonly processOrderCommand: ProcessOrderCommand,
    @Inject(PROCESS_EXPIRE_COMMAND_USE_CASE)
    private readonly processExpireCommand: ProcessExpireCommand,
    @Inject(LOGGER) private readonly logger: Logger
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.info("Subscribing to exchange commands", {
      consumerGroupId: this.config.kafka.consumerGroupId,
      instanceId: this.getInstanceId(),
      partitions: this.config.kafka.commandsPartitions,
      topic: this.config.kafka.commandsTopic
    });

    await this.commandConsumer.subscribe({
      topic: this.config.kafka.commandsTopic,
      groupId: this.config.kafka.consumerGroupId,
      onCommand: async (command) => this.handle(command)
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.commandConsumer.disconnect();
  }

  private async handle(command: ConsumedCommand): Promise<void> {
    try {
      const result =
        command.command.command_type === "SubmitOrder"
          ? await this.processOrderCommand.execute(command.command)
          : await this.processExpireCommand.execute(command.command);

      this.logger.info("Exchange command processed", {
        commandId: command.command.command_id,
        commandType: command.command.command_type,
        instanceId: this.getInstanceId(),
        orderId: command.command.order_id,
        symbol: command.command.symbol,
        offset: command.offset,
        partition: command.partition,
        status: result.status,
        ...(command.command.command_type === "SubmitOrder"
          ? {
              finalStatus: (result as ProcessOrderCommandResult).finalStatus,
              trades: (result as ProcessOrderCommandResult).trades
            }
          : {
              reason: (result as ProcessExpireCommandResult).reason
            })
      });
    } catch (error) {
      this.logger.error("Exchange command processing failed", {
        commandId: command.command.command_id,
        commandType: command.command.command_type,
        instanceId: this.getInstanceId(),
        orderId: command.command.order_id,
        symbol: command.command.symbol,
        offset: command.offset,
        partition: command.partition,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  private getInstanceId(): string {
    return process.env.HOSTNAME ?? this.config.serviceName;
  }
}
