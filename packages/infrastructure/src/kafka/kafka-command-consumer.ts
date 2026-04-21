import type { CommandConsumer, ConsumedCommand } from "@decade/application";

import { decodeCommand } from "./kafka-command-codec";

export interface KafkaConsumerLike {
  connect(): Promise<void>;
  subscribe(options: { topic: string; fromBeginning?: boolean }): Promise<void>;
  run(options: {
    eachMessage(payload: {
      topic: string;
      partition: number;
      message: {
        key: Buffer | string | null;
        value: Buffer | string | null;
        headers?: Record<
          string,
          Buffer | string | Array<Buffer | string> | undefined
        >;
        offset: string;
        timestamp: string;
      };
    }): Promise<void>;
  }): Promise<void>;
  disconnect(): Promise<void>;
}

function normalizeHeaderValue(
  value: Buffer | string | Array<Buffer | string> | undefined
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const firstValue = value[0];

    return firstValue === undefined ? undefined : normalizeHeaderValue(firstValue);
  }

  return typeof value === "string" ? value : value.toString("utf8");
}

function normalizeHeaders(
  headers?: Record<string, Buffer | string | Array<Buffer | string> | undefined>
): Record<string, string> | undefined {
  if (headers === undefined) {
    return undefined;
  }

  const normalized = Object.entries(headers).reduce<Record<string, string>>(
    (accumulator, [key, value]) => {
      const normalizedValue = normalizeHeaderValue(value);

      if (normalizedValue !== undefined) {
        accumulator[key] = normalizedValue;
      }

      return accumulator;
    },
    {}
  );

  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function normalizeKey(value: Buffer | string | null): string {
  if (value === null) {
    throw new Error("Kafka message is missing a key");
  }

  return typeof value === "string" ? value : value.toString("utf8");
}

export class KafkaCommandConsumer implements CommandConsumer {
  private activeConsumer: KafkaConsumerLike | null = null;

  constructor(private readonly createConsumer: (groupId: string) => KafkaConsumerLike) {}

  async subscribe(options: {
    topic: string;
    groupId: string;
    fromBeginning?: boolean;
    onCommand(command: ConsumedCommand): Promise<void>;
  }): Promise<void> {
    if (this.activeConsumer !== null) {
      throw new Error("Kafka consumer is already subscribed");
    }

    const consumer = this.createConsumer(options.groupId);
    this.activeConsumer = consumer;

    await consumer.connect();
    await consumer.subscribe({
      topic: options.topic,
      fromBeginning: options.fromBeginning
    });
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const command = decodeCommand(message.value ?? undefined);

        await options.onCommand({
          topic,
          partition,
          offset: message.offset,
          timestamp: message.timestamp,
          key: normalizeKey(message.key),
          headers: normalizeHeaders(message.headers),
          command
        });
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.activeConsumer === null) {
      return;
    }

    const consumer = this.activeConsumer;
    this.activeConsumer = null;
    await consumer.disconnect();
  }
}
