import type { CommandPublisher, PublishedCommand } from "@decade/application";

import { encodeCommand } from "./kafka-command-codec";

export interface KafkaProducerLike {
  send(record: {
    topic: string;
    messages: Array<{
      key: string;
      value: string;
      headers?: Record<string, string>;
    }>;
  }): Promise<unknown>;
}

export class KafkaCommandPublisher implements CommandPublisher {
  constructor(private readonly producer: KafkaProducerLike) {}

  async publish(command: PublishedCommand): Promise<void> {
    await this.producer.send({
      topic: command.topic,
      messages: [
        {
          key: command.key,
          value: encodeCommand(command.command),
          headers: command.headers
        }
      ]
    });
  }
}

