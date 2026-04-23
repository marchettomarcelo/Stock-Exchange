import { Kafka, Partitioners } from "kafkajs";

import {
  KafkaCommandConsumer,
  KafkaCommandPublisher
} from "@decade/application";
import type { KafkaConfig } from "../config/app-config";

export function createKafkaClient(config: KafkaConfig): Kafka {
  return new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
    ssl: config.ssl
  });
}

interface DisconnectableProducer {
  send(record: {
    topic: string;
    messages: Array<{
      key: string;
      value: string;
      headers?: Record<string, string>;
    }>;
  }): Promise<unknown>;
  disconnect(): Promise<void>;
}

export class ManagedKafkaCommandPublisher
  extends KafkaCommandPublisher
{
  constructor(private readonly disconnectableProducer: DisconnectableProducer) {
    super(disconnectableProducer);
  }

  async disconnect(): Promise<void> {
    await this.disconnectableProducer.disconnect();
  }
}

export type DisconnectablePublisher = ManagedKafkaCommandPublisher;

export async function createKafkaPublisher(kafka: Kafka): Promise<ManagedKafkaCommandPublisher> {
  const producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner
  });

  await producer.connect();

  return new ManagedKafkaCommandPublisher(producer);
}

export function createKafkaConsumer(kafka: Kafka): KafkaCommandConsumer {
  return new KafkaCommandConsumer((groupId) => kafka.consumer({ groupId }));
}
