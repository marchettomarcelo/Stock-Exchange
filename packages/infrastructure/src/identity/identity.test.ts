import { describe, expect, it } from "vitest";

import { JsonRequestHasher } from "./json-request-hasher";
import { SystemIdGenerator } from "./system-id-generator";

describe("identity helpers", () => {
  it("creates prefixed order and command ids", () => {
    const generator = new SystemIdGenerator();

    expect(generator.nextOrderId()).toMatch(/^ord_[0-9a-f-]{36}$/);
    expect(generator.nextCommandId()).toMatch(/^cmd_[0-9a-f-]{36}$/);
  });

  it("hashes equivalent objects deterministically regardless of key order", () => {
    const hasher = new JsonRequestHasher();

    const left = {
      idempotency_key: "idem-1",
      payload: {
        quantity: 10,
        price: 100
      }
    };
    const right = {
      payload: {
        price: 100,
        quantity: 10
      },
      idempotency_key: "idem-1"
    };

    expect(hasher.hash(left)).toBe(hasher.hash(right));
  });
});
