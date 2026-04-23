import {
  expireOrderCommandSchema,
  submitOrderCommandSchema
} from "@decade/contracts";

import type { ExchangeCommand } from "../messages";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function encodeCommand(command: ExchangeCommand): string {
  return JSON.stringify(command);
}

export function decodeCommand(value: Buffer | string | undefined): ExchangeCommand {
  if (value === undefined) {
    throw new Error("Kafka message is missing a value");
  }

  const raw = typeof value === "string" ? value : value.toString("utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed) || typeof parsed.command_type !== "string") {
    throw new Error("Kafka message payload is missing command_type");
  }

  switch (parsed.command_type) {
    case "SubmitOrder":
      return submitOrderCommandSchema.parse(parsed);
    case "ExpireOrder":
      return expireOrderCommandSchema.parse(parsed);
    default:
      throw new Error(`Unsupported command_type: ${parsed.command_type}`);
  }
}
