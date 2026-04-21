import { describe, expect, it } from "vitest";

import { KafkaCommandConsumer } from "./kafka-command-consumer";
import { KafkaCommandPublisher } from "./kafka-command-publisher";

describe("Kafka adapters", () => {
  it("publishes a serialized command with key and headers", async () => {
    const sent: Array<{
      topic: string;
      messages: Array<{ key: string; value: string; headers?: Record<string, string> }>;
    }> = [];
    const publisher = new KafkaCommandPublisher({
      send: async (record) => {
        sent.push(record);
      }
    });

    await publisher.publish({
      topic: "exchange.commands",
      key: "AAPL",
      headers: {
        source: "test"
      },
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

    expect(sent).toEqual([
      {
        topic: "exchange.commands",
        messages: [
          {
            key: "AAPL",
            value:
              '{"command_id":"cmd-1","command_type":"SubmitOrder","order_id":"ord-1","broker_id":"broker-1","owner_document":"12345678900","side":"bid","symbol":"AAPL","price":100,"quantity":10,"valid_until":"2026-01-01T15:00:00Z","accepted_at":"2026-01-01T14:00:00Z"}',
            headers: {
              source: "test"
            }
          }
        ]
      }
    ]);
  });

  it("subscribes and decodes commands before calling the handler", async () => {
    let eachMessage:
      | ((payload: {
          topic: string;
          partition: number;
          message: {
            key: Buffer | string | null;
            value: Buffer | string | null;
            headers?: Record<string, Buffer | string | undefined>;
            offset: string;
            timestamp: string;
          };
        }) => Promise<void>)
      | undefined;
    let disconnected = false;

    const consumer = new KafkaCommandConsumer(() => ({
      connect: async () => undefined,
      subscribe: async () => undefined,
      run: async (options) => {
        eachMessage = options.eachMessage;
      },
      disconnect: async () => {
        disconnected = true;
      }
    }));

    const received: unknown[] = [];

    await consumer.subscribe({
      topic: "exchange.commands",
      groupId: "matching-engine",
      onCommand: async (command) => {
        received.push(command);
      }
    });

    await eachMessage?.({
      topic: "exchange.commands",
      partition: 1,
      message: {
        key: Buffer.from("AAPL"),
        value: Buffer.from(
          JSON.stringify({
            command_id: "cmd-1",
            command_type: "ExpireOrder",
            order_id: "ord-1",
            symbol: "AAPL",
            expires_at: "2026-01-01T15:00:00Z"
          })
        ),
        headers: {
          source: Buffer.from("scheduler")
        },
        offset: "42",
        timestamp: "1700000000000"
      }
    });

    expect(received).toEqual([
      {
        topic: "exchange.commands",
        partition: 1,
        offset: "42",
        timestamp: "1700000000000",
        key: "AAPL",
        headers: {
          source: "scheduler"
        },
        command: {
          command_id: "cmd-1",
          command_type: "ExpireOrder",
          order_id: "ord-1",
          symbol: "AAPL",
          expires_at: "2026-01-01T15:00:00Z"
        }
      }
    ]);

    await consumer.disconnect();

    expect(disconnected).toBe(true);
  });
});

