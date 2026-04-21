import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ApplicationError, NotFoundError } from "@decade/application";

import { OrdersController } from "../src/orders/orders.controller";

describe("OrdersController", () => {
  it("submits a validated order request and returns the accepted response", async () => {
    const submitOrder = {
      execute: vi.fn().mockResolvedValue({
        order_id: "ord-1",
        status: "accepted",
        accepted_at: "2026-01-01T14:00:00Z"
      })
    };
    const controller = new OrdersController(
      submitOrder as never,
      {
        execute: vi.fn()
      } as never
    );

    const response = await controller.submit({
      owner_document: "12345678900",
      side: "bid",
      symbol: "AAPL",
      price: 100,
      quantity: 10,
      valid_until: "2026-01-01T15:00:00Z",
      idempotency_key: "idem-1"
    });

    expect(submitOrder.execute).toHaveBeenCalledWith({
      owner_document: "12345678900",
      side: "bid",
      symbol: "AAPL",
      price: 100,
      quantity: 10,
      valid_until: "2026-01-01T15:00:00Z",
      idempotency_key: "idem-1"
    });
    expect(response).toEqual({
      order_id: "ord-1",
      status: "accepted",
      accepted_at: "2026-01-01T14:00:00Z"
    });
  });

  it("rejects invalid order bodies with a 400 error", async () => {
    const controller = new OrdersController(
      {
        execute: vi.fn()
      } as never,
      {
        execute: vi.fn()
      } as never
    );

    await expect(
      controller.submit({
        owner_document: "12345678900",
        side: "bid",
        symbol: "aapl",
        price: 100,
        quantity: 10,
        valid_until: "2026-01-01T15:00:00Z",
        idempotency_key: "idem-1"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("maps missing orders to a 404 error", async () => {
    const controller = new OrdersController(
      {
        execute: vi.fn()
      } as never,
      {
        execute: vi.fn().mockRejectedValue(new NotFoundError("missing"))
      } as never
    );

    await expect(controller.getStatus("ord-404")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("maps application invariants to a 500 error", async () => {
    const controller = new OrdersController(
      {
        execute: vi.fn().mockRejectedValue(new ApplicationError("broken"))
      } as never,
      {
        execute: vi.fn()
      } as never
    );

    await expect(
      controller.submit({
        owner_document: "12345678900",
        side: "bid",
        symbol: "AAPL",
        price: 100,
        quantity: 10,
        valid_until: "2026-01-01T15:00:00Z",
        idempotency_key: "idem-1"
      })
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
