import type { ConsumedCommand, PublishedCommand } from "../messages";

export interface CommandPublisher {
  publish(command: PublishedCommand): Promise<void>;
}

export interface CommandConsumer {
  subscribe(options: {
    topic: string;
    groupId: string;
    fromBeginning?: boolean;
    onCommand(command: ConsumedCommand): Promise<void>;
  }): Promise<void>;
  disconnect(): Promise<void>;
}

