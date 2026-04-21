import { describe, expect, it, vi } from "vitest";

import type { CommandConsumer, ConsumedCommand, Logger } from "@decade/application";

import { ExchangeCommandsConsumer } from "../src/engine/exchange-commands-consumer";
import { MatchingEngineRuntime } from "../src/runtime/runtime.shutdown";

class FakeCommandConsumer implements CommandConsumer {
  subscription:
    | {
        topic: string;
        groupId: string;
        fromBeginning?: boolean;
        onCommand(command: ConsumedCommand): Promise<void>;
      }
    | undefined;
  disconnected = false;

  async subscribe(options: {
    topic: string;
    groupId: string;
    fromBeginning?: boolean;
    onCommand(command: ConsumedCommand): Promise<void>;
  }): Promise<void> {
    this.subscription = options;
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }
}

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("ExchangeCommandsConsumer", () => {
  it("subscribes with the configured topic and group and routes submit commands", async () => {
    const commandConsumer = new FakeCommandConsumer();
    const processOrderCommand = {
      execute: vi.fn().mockResolvedValue({
        status: "processed",
        orderId: "ord-1",
        finalStatus: "open",
        trades: 1
      })
    };
    const processExpireCommand = {
      execute: vi.fn()
    };
    const service = new ExchangeCommandsConsumer(
      commandConsumer,
      {
        serviceName: "matching-engine",
        logLevel: "info",
        database: {
          connectionString: "postgres://test",
          maxConnections: 10
        },
        kafka: {
          brokers: ["localhost:9092"],
          clientId: "decade",
          consumerGroupId: "matching-engine-workers",
          ssl: false,
          commandsTopic: "exchange.commands",
          commandsPartitions: 2
        },
        expiration: {
          scanIntervalMs: 1000,
          scanLimit: 100,
          leaseName: "expiration-scheduler"
        }
      },
      processOrderCommand as never,
      processExpireCommand as never,
      createLogger()
    );

    await service.onApplicationBootstrap();
    await commandConsumer.subscription?.onCommand({
      topic: "exchange.commands",
      partition: 0,
      offset: "1",
      timestamp: "1700000000000",
      key: "AAPL",
      command: {
        command_id: "cmd-1",
        command_type: "SubmitOrder",
        order_id: "ord-1",
        broker_id: "broker-1",
        owner_document: "12345678900",
        side: "bid",
        symbol: "AAPL",
        price: 100,
        quantity: 10,
        valid_until: "2026-01-01T15:00:00Z",
        accepted_at: "2026-01-01T14:00:00Z"
      }
    });

    expect(commandConsumer.subscription).toMatchObject({
      topic: "exchange.commands",
      groupId: "matching-engine-workers"
    });
    expect(processOrderCommand.execute).toHaveBeenCalledWith({
      command_id: "cmd-1",
      command_type: "SubmitOrder",
      order_id: "ord-1",
      broker_id: "broker-1",
      owner_document: "12345678900",
      side: "bid",
      symbol: "AAPL",
      price: 100,
      quantity: 10,
      valid_until: "2026-01-01T15:00:00Z",
      accepted_at: "2026-01-01T14:00:00Z"
    });
    expect(processExpireCommand.execute).not.toHaveBeenCalled();
  });

  it("routes expire commands and disconnects on shutdown", async () => {
    const commandConsumer = new FakeCommandConsumer();
    const processOrderCommand = {
      execute: vi.fn()
    };
    const processExpireCommand = {
      execute: vi.fn().mockResolvedValue({
        status: "expired",
        orderId: "ord-1"
      })
    };
    const service = new ExchangeCommandsConsumer(
      commandConsumer,
      {
        serviceName: "matching-engine",
        logLevel: "info",
        database: {
          connectionString: "postgres://test",
          maxConnections: 10
        },
        kafka: {
          brokers: ["localhost:9092"],
          clientId: "decade",
          consumerGroupId: "matching-engine-workers",
          ssl: false,
          commandsTopic: "exchange.commands",
          commandsPartitions: 2
        },
        expiration: {
          scanIntervalMs: 1000,
          scanLimit: 100,
          leaseName: "expiration-scheduler"
        }
      },
      processOrderCommand as never,
      processExpireCommand as never,
      createLogger()
    );

    await service.onApplicationBootstrap();
    await commandConsumer.subscription?.onCommand({
      topic: "exchange.commands",
      partition: 0,
      offset: "2",
      timestamp: "1700000001000",
      key: "AAPL",
      command: {
        command_id: "cmd-2",
        command_type: "ExpireOrder",
        order_id: "ord-1",
        symbol: "AAPL",
        expires_at: "2026-01-01T15:00:00Z"
      }
    });
    await service.onApplicationShutdown();

    expect(processExpireCommand.execute).toHaveBeenCalledWith({
      command_id: "cmd-2",
      command_type: "ExpireOrder",
      order_id: "ord-1",
      symbol: "AAPL",
      expires_at: "2026-01-01T15:00:00Z"
    });
    expect(commandConsumer.disconnected).toBe(true);
  });

  it("closes the postgres pool on shutdown", async () => {
    const pool = {
      end: vi.fn()
    };
    const publisher = {
      disconnect: vi.fn()
    };
    const runtime = new MatchingEngineRuntime(pool as never, publisher as never);

    await runtime.onApplicationShutdown();

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(publisher.disconnect).toHaveBeenCalledTimes(1);
  });
});
