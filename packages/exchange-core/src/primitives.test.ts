import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  createPrice,
  createQuantity,
  createSymbol,
  createValidUntil
} from "./index";

describe("exchange-core primitives", () => {
  it("creates a symbol when the value is uppercase", () => {
    expect(createSymbol("AAPL")).toBe("AAPL");
  });

  it("rejects lowercase symbols", () => {
    expect(() => createSymbol("aapl")).toThrow(DomainValidationError);
  });

  it("creates positive integer prices", () => {
    expect(createPrice(100)).toBe(100);
  });

  it("rejects fractional prices", () => {
    expect(() => createPrice(10.5)).toThrow(DomainValidationError);
  });

  it("creates positive integer quantities", () => {
    expect(createQuantity(10)).toBe(10);
  });

  it("normalizes valid timestamps to ISO strings", () => {
    expect(createValidUntil("2026-01-01T12:00:00-03:00")).toBe("2026-01-01T15:00:00.000Z");
  });
});

