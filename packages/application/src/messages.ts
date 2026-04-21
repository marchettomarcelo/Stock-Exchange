import type { ExpireOrderCommand, SubmitOrderCommand } from "@decade/contracts";

export type ExchangeCommand = SubmitOrderCommand | ExpireOrderCommand;
export type ExchangeCommandType = ExchangeCommand["command_type"];

export interface PublishedCommand {
  topic: string;
  key: string;
  command: ExchangeCommand;
  headers?: Record<string, string>;
}

export interface ConsumedCommand extends PublishedCommand {
  partition: number;
  offset: string;
  timestamp: string;
}

