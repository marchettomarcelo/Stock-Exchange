import path from "node:path";

import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createBrokerId,
  createIsoTimestamp,
  createOrderId,
  createOwnerDocument,
  createPrice,
  createSymbol,
  createValidUntil
} from "@decade/exchange-core";
import { applyMigrations } from "../../../../db/scripts/migrations";
import { PostgresIdempotencyRepository } from "./postgres-idempotency-repository";
import { PostgresOrderEventRepository } from "./postgres-order-event-repository";
import { PostgresOrderRepository } from "./postgres-order-repository";
import { PostgresProcessedCommandRepository } from "./postgres-processed-command-repository";
import { PostgresTradeRepository } from "./postgres-trade-repository";

const migrationsDirectory = path.resolve(__dirname, "../../../../db/migrations");

function registerPgMemFunctions(db: ReturnType<typeof newDb>): void {
  db.public.registerFunction({
    name: "char_length",
    args: ["text"],
    returns: "int4",
    implementation: (value: string) => value.length
  });
  db.public.registerFunction({
    name: "translate",
    args: ["text", "text", "text"],
    returns: "text",
    implementation: (value: string, from: string, to: string) => {
      const replacementMap = new Map<string, string>();

      for (const [index, char] of [...from].entries()) {
        replacementMap.set(char, to[index] ?? "");
      }

      return [...value]
        .map((char) => replacementMap.get(char) ?? char)
        .join("");
    }
  });
}

describe("PostgreSQL repositories", () => {
  let orderRepository: PostgresOrderRepository;
  let tradeRepository: PostgresTradeRepository;
  let eventRepository: PostgresOrderEventRepository;
  let idempotencyRepository: PostgresIdempotencyRepository;
  let processedCommandRepository: PostgresProcessedCommandRepository;

  beforeEach(async () => {
    const db = newDb();
    registerPgMemFunctions(db);

    const pg = db.adapters.createPg();
    const pool = new pg.Pool();

    await applyMigrations(pool, migrationsDirectory);

    orderRepository = new PostgresOrderRepository(pool);
    tradeRepository = new PostgresTradeRepository(pool);
    eventRepository = new PostgresOrderEventRepository(pool);
    idempotencyRepository = new PostgresIdempotencyRepository(pool);
    processedCommandRepository = new PostgresProcessedCommandRepository(pool);
  });

  it("creates, updates, and queries orders with recovery data", async () => {
    const restingSequence = await orderRepository.nextRestingSequence();
    const acceptedOrder = {
      orderId: createOrderId("ord-1"),
      brokerId: createBrokerId("broker-1"),
      ownerDocument: createOwnerDocument("12345678900"),
      symbol: createSymbol("AAPL"),
      side: "bid" as const,
      price: createPrice(100),
      originalQuantity: 10,
      remainingQuantity: 10,
      status: "accepted" as const,
      validUntil: createValidUntil("2026-01-01T15:00:00Z"),
      acceptedAt: createIsoTimestamp("2026-01-01T14:00:00Z"),
      updatedAt: createIsoTimestamp("2026-01-01T14:00:00Z"),
      restingSequence: null
    };

    await orderRepository.createAcceptedOrder(acceptedOrder);
    await orderRepository.updateOrder({
      ...acceptedOrder,
      status: "open",
      restingSequence,
      updatedAt: createIsoTimestamp("2026-01-01T14:00:01Z")
    });

    const foundOrder = await orderRepository.findOrderById(createOrderId("ord-1"));
    const dueOrders = await orderRepository.listDueOrders(
      createIsoTimestamp("2026-01-01T15:00:00Z"),
      10
    );
    const recoveryOrders = await orderRepository.listRestingOrdersForSymbol(createSymbol("AAPL"));

    expect(foundOrder).toMatchObject({
      orderId: "ord-1",
      status: "open",
      restingSequence
    });
    expect(dueOrders).toEqual([
      {
        orderId: "ord-1",
        symbol: "AAPL",
        validUntil: "2026-01-01T15:00:00.000Z",
        status: "open"
      }
    ]);
    expect(recoveryOrders).toEqual([
      expect.objectContaining({
        orderId: "ord-1",
        symbol: "AAPL",
        restingSequence
      })
    ]);
  });

  it("persists trades, events, idempotency keys, and processed commands", async () => {
    await orderRepository.createAcceptedOrder({
      orderId: createOrderId("ord-1"),
      brokerId: createBrokerId("broker-1"),
      ownerDocument: createOwnerDocument("12345678900"),
      symbol: createSymbol("AAPL"),
      side: "bid",
      price: createPrice(100),
      originalQuantity: 10,
      remainingQuantity: 0,
      status: "filled",
      validUntil: createValidUntil("2026-01-01T15:00:00Z"),
      acceptedAt: createIsoTimestamp("2026-01-01T14:00:00Z"),
      updatedAt: createIsoTimestamp("2026-01-01T14:01:00Z"),
      restingSequence: null
    });
    await orderRepository.createAcceptedOrder({
      orderId: createOrderId("ord-2"),
      brokerId: createBrokerId("broker-2"),
      ownerDocument: createOwnerDocument("10987654321"),
      symbol: createSymbol("AAPL"),
      side: "ask",
      price: createPrice(100),
      originalQuantity: 10,
      remainingQuantity: 0,
      status: "filled",
      validUntil: createValidUntil("2026-01-01T15:00:00Z"),
      acceptedAt: createIsoTimestamp("2026-01-01T14:00:00Z"),
      updatedAt: createIsoTimestamp("2026-01-01T14:01:00Z"),
      restingSequence: null
    });

    await tradeRepository.appendTrades([
      {
        symbol: createSymbol("AAPL"),
        buyOrderId: createOrderId("ord-1"),
        sellOrderId: createOrderId("ord-2"),
        price: createPrice(100),
        quantity: 10,
        executedAt: createIsoTimestamp("2026-01-01T14:01:00Z")
      }
    ]);
    await eventRepository.appendEvents([
      {
        orderId: createOrderId("ord-1"),
        eventType: "filled",
        payload: {
          quantity: 10
        },
        createdAt: createIsoTimestamp("2026-01-01T14:01:00Z")
      }
    ]);
    await idempotencyRepository.create({
      brokerId: createBrokerId("broker-1"),
      idempotencyKey: "idem-1",
      orderId: createOrderId("ord-1"),
      commandId: "cmd-submit-1",
      symbol: createSymbol("AAPL"),
      requestHash: "hash-1",
      publishStatus: "pending",
      createdAt: createIsoTimestamp("2026-01-01T14:00:00Z"),
      publishedAt: null
    });
    await idempotencyRepository.markPublished(
      createBrokerId("broker-1"),
      "idem-1",
      createIsoTimestamp("2026-01-01T14:00:01Z")
    );
    await processedCommandRepository.markProcessed({
      commandId: "cmd-1",
      commandType: "SubmitOrder",
      symbol: createSymbol("AAPL"),
      orderId: createOrderId("ord-1"),
      processedAt: createIsoTimestamp("2026-01-01T14:01:00Z")
    });

    expect(await tradeRepository.listTradesForOrder(createOrderId("ord-1"))).toEqual([
      expect.objectContaining({
        buyOrderId: "ord-1",
        sellOrderId: "ord-2",
        quantity: 10
      })
    ]);
    expect(await eventRepository.listEventsForOrder(createOrderId("ord-1"))).toEqual([
      expect.objectContaining({
        eventType: "filled",
        payload: {
          quantity: 10
        }
      })
    ]);
    expect(
      await idempotencyRepository.findByBrokerAndKey(createBrokerId("broker-1"), "idem-1")
    ).toEqual(
      expect.objectContaining({
        orderId: "ord-1",
        commandId: "cmd-submit-1",
        symbol: "AAPL",
        requestHash: "hash-1",
        publishStatus: "published",
        publishedAt: "2026-01-01T14:00:01.000Z"
      })
    );
    expect(await processedCommandRepository.findByCommandId("cmd-1")).toEqual(
      expect.objectContaining({
        commandType: "SubmitOrder",
        orderId: "ord-1"
      })
    );
  });
});
