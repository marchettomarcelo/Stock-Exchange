import { describe, expect, it } from "vitest";

import { submitOrderCommandSchema } from "./commands";
import { submitOrderRequestSchema } from "./orders";

describe("contracts", () => {
  it("accepts a valid submit order request", () => {
    const parsed = submitOrderRequestSchema.parse({
      broker_id: "broker-1",
      owner_document: "12345678900",
      side: "bid",
      symbol: "AAPL",
      price: 100,
      quantity: 10,
      valid_until: "2026-01-01T15:00:00Z",
      idempotency_key: "request-1"
    });

    expect(parsed).toMatchObject({
      broker_id: "broker-1",
      symbol: "AAPL"
    });
  });

  it("rejects lowercase symbols in the request contract", () => {
    expect(() =>
      submitOrderRequestSchema.parse({
        broker_id: "broker-1",
        owner_document: "12345678900",
        side: "bid",
        symbol: "aapl",
        price: 100,
        quantity: 10,
        valid_until: "2026-01-01T15:00:00Z",
        idempotency_key: "request-1"
      })
    ).toThrow();
  });

  it("requires broker_id in the submit order request", () => {
    expect(() =>
      submitOrderRequestSchema.parse({
        owner_document: "12345678900",
        side: "bid",
        symbol: "AAPL",
        price: 100,
        quantity: 10,
        valid_until: "2026-01-01T15:00:00Z",
        idempotency_key: "request-1"
      })
    ).toThrow();
  });

  it("accepts a valid submit order command", () => {
    const parsed = submitOrderCommandSchema.parse({
      command_id: "cmd-1",
      command_type: "SubmitOrder",
      order_id: "ord-1",
      broker_id: "broker-1",
      owner_document: "12345678900",
      side: "ask",
      symbol: "AAPL",
      price: 100,
      quantity: 10,
      valid_until: "2026-01-01T15:00:00Z",
      accepted_at: "2026-01-01T14:00:00Z"
    });

    expect(parsed.command_type).toBe("SubmitOrder");
  });
});
