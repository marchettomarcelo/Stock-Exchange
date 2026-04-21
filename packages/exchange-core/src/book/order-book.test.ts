import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  OrderBook,
  createBrokerId,
  createIsoTimestamp,
  createOrderId,
  createOwnerDocument,
  createPrice,
  createQuantity,
  createSymbol,
  createValidUntil,
  type OrderInput,
  type OrderSide
} from "../index";

function createOrderInput(params: {
  orderId: string;
  side: OrderSide;
  price: number;
  quantity: number;
  validUntil?: string;
  acceptedAt?: string;
}): OrderInput {
  return {
    orderId: createOrderId(params.orderId),
    brokerId: createBrokerId("broker-1"),
    ownerDocument: createOwnerDocument("12345678900"),
    symbol: createSymbol("AAPL"),
    side: params.side,
    price: createPrice(params.price),
    quantity: createQuantity(params.quantity),
    validUntil: createValidUntil(params.validUntil ?? "2026-01-01T15:00:00Z"),
    acceptedAt: createIsoTimestamp(params.acceptedAt ?? "2026-01-01T14:00:00Z")
  };
}

function findUpdate(result: { updates: Array<{ orderId: string }> }, orderId: string) {
  const update = result.updates.find((candidate) => candidate.orderId === orderId);

  expect(update).toBeDefined();

  return update!;
}

describe("OrderBook", () => {
  it("matches full size at the same price", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    book.placeOrder(
      createOrderInput({ orderId: "ask-1", side: "ask", price: 10, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );

    const result = book.placeOrder(
      createOrderInput({ orderId: "bid-1", side: "bid", price: 10, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:01Z")
    );

    expect(result.trades).toEqual([
      {
        symbol: "AAPL",
        buyOrderId: "bid-1",
        sellOrderId: "ask-1",
        price: 10,
        quantity: 100,
        executedAt: "2026-01-01T14:00:01.000Z"
      }
    ]);
    expect(findUpdate(result, "ask-1").status).toBe("filled");
    expect(findUpdate(result, "bid-1").status).toBe("filled");
    expect(book.getBestBid()).toBeNull();
    expect(book.getBestAsk()).toBeNull();
    expect(book.getOpenOrders()).toEqual([]);
  });

  it("executes crossing prices at the seller price", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    book.placeOrder(
      createOrderInput({ orderId: "ask-1", side: "ask", price: 10, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );

    const result = book.placeOrder(
      createOrderInput({ orderId: "bid-1", side: "bid", price: 20, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:01Z")
    );

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.price).toBe(10);
  });

  it("keeps both orders open when prices do not cross", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    book.placeOrder(
      createOrderInput({ orderId: "ask-1", side: "ask", price: 20, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );

    const result = book.placeOrder(
      createOrderInput({ orderId: "bid-1", side: "bid", price: 10, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:01Z")
    );

    expect(result.trades).toEqual([]);
    expect(book.getBestAsk()?.orderId).toBe("ask-1");
    expect(book.getBestBid()?.orderId).toBe("bid-1");
    expect(book.getBestAsk()?.price).toBe(20);
    expect(book.getBestBid()?.price).toBe(10);
  });

  it("supports partial fills and leaves the remainder resting", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    book.placeOrder(
      createOrderInput({ orderId: "ask-1", side: "ask", price: 10, quantity: 1000 }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );

    const result = book.placeOrder(
      createOrderInput({ orderId: "bid-1", side: "bid", price: 10, quantity: 500 }),
      createIsoTimestamp("2026-01-01T14:00:01Z")
    );

    expect(result.trades).toEqual([
      {
        symbol: "AAPL",
        buyOrderId: "bid-1",
        sellOrderId: "ask-1",
        price: 10,
        quantity: 500,
        executedAt: "2026-01-01T14:00:01.000Z"
      }
    ]);
    expect(findUpdate(result, "bid-1").status).toBe("filled");
    expect(findUpdate(result, "ask-1")).toMatchObject({
      status: "partially_filled",
      remainingQuantity: 500
    });
    expect(book.getBestAsk()).toMatchObject({
      orderId: "ask-1",
      remainingQuantity: 500
    });
  });

  it("preserves FIFO order within the same price level", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    book.placeOrder(
      createOrderInput({
        orderId: "ask-1",
        side: "ask",
        price: 10,
        quantity: 100,
        acceptedAt: "2026-01-01T14:00:00Z"
      }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );
    book.placeOrder(
      createOrderInput({
        orderId: "ask-2",
        side: "ask",
        price: 10,
        quantity: 100,
        acceptedAt: "2026-01-01T14:00:01Z"
      }),
      createIsoTimestamp("2026-01-01T14:00:01Z")
    );

    const result = book.placeOrder(
      createOrderInput({ orderId: "bid-1", side: "bid", price: 10, quantity: 150 }),
      createIsoTimestamp("2026-01-01T14:00:02Z")
    );

    expect(result.trades).toHaveLength(2);
    expect(result.trades.map((trade) => trade.sellOrderId)).toEqual(["ask-1", "ask-2"]);
    expect(findUpdate(result, "ask-1").status).toBe("filled");
    expect(findUpdate(result, "ask-2")).toMatchObject({
      status: "partially_filled",
      remainingQuantity: 50
    });
    expect(book.getBestAsk()).toMatchObject({
      orderId: "ask-2",
      remainingQuantity: 50
    });
  });

  it("prioritizes the best price before later worse prices", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    book.placeOrder(
      createOrderInput({ orderId: "ask-11", side: "ask", price: 11, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );
    book.placeOrder(
      createOrderInput({ orderId: "ask-10", side: "ask", price: 10, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:01Z")
    );

    const result = book.placeOrder(
      createOrderInput({ orderId: "bid-1", side: "bid", price: 11, quantity: 150 }),
      createIsoTimestamp("2026-01-01T14:00:02Z")
    );

    expect(result.trades).toHaveLength(2);
    expect(result.trades.map((trade) => trade.sellOrderId)).toEqual(["ask-10", "ask-11"]);
    expect(result.trades.map((trade) => trade.price)).toEqual([10, 11]);
    expect(book.getBestAsk()).toMatchObject({
      orderId: "ask-11",
      remainingQuantity: 50
    });
  });

  it("marks already expired orders as expired without adding them to the book", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    const result = book.placeOrder(
      createOrderInput({
        orderId: "bid-expired",
        side: "bid",
        price: 10,
        quantity: 100,
        validUntil: "2026-01-01T13:59:59Z"
      }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );

    expect(result.trades).toEqual([]);
    expect(result.order.status).toBe("expired");
    expect(book.hasOrder(createOrderId("bid-expired"))).toBe(false);
    expect(book.getOpenOrders()).toEqual([]);
  });

  it("prevents duplicate open order ids", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    book.placeOrder(
      createOrderInput({ orderId: "bid-1", side: "bid", price: 10, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );

    expect(() =>
      book.placeOrder(
        createOrderInput({ orderId: "bid-1", side: "bid", price: 11, quantity: 100 }),
        createIsoTimestamp("2026-01-01T14:00:01Z")
      )
    ).toThrow(DomainValidationError);
  });

  it("expires a resting order when the expiration time is reached", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    book.placeOrder(
      createOrderInput({
        orderId: "ask-1",
        side: "ask",
        price: 10,
        quantity: 100,
        validUntil: "2026-01-01T14:05:00Z"
      }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );

    const expired = book.expireOrder(
      createOrderId("ask-1"),
      createIsoTimestamp("2026-01-01T14:05:00Z")
    );

    expect(expired).toMatchObject({
      orderId: "ask-1",
      status: "expired",
      remainingQuantity: 100
    });
    expect(book.getBestAsk()).toBeNull();
  });

  it("does not expire an order before its validity time", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    book.placeOrder(
      createOrderInput({
        orderId: "ask-1",
        side: "ask",
        price: 10,
        quantity: 100,
        validUntil: "2026-01-01T14:05:00Z"
      }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );

    expect(
      book.expireOrder(createOrderId("ask-1"), createIsoTimestamp("2026-01-01T14:04:59Z"))
    ).toBeNull();
    expect(book.hasOrder(createOrderId("ask-1"))).toBe(true);
  });

  it("does not leave crossed open orders after matching completes", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    book.placeOrder(
      createOrderInput({ orderId: "ask-1", side: "ask", price: 10, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:00Z")
    );
    book.placeOrder(
      createOrderInput({ orderId: "ask-2", side: "ask", price: 11, quantity: 100 }),
      createIsoTimestamp("2026-01-01T14:00:01Z")
    );
    book.placeOrder(
      createOrderInput({ orderId: "bid-1", side: "bid", price: 12, quantity: 250 }),
      createIsoTimestamp("2026-01-01T14:00:02Z")
    );

    const bestBid = book.getBestBid();
    const bestAsk = book.getBestAsk();

    expect(bestBid?.price).toBe(12);
    expect(bestAsk).toBeNull();
    if (bestBid !== null && bestAsk !== null) {
      expect(bestBid.price).toBeLessThan(bestAsk.price);
    }
  });

  it("restores live orders into the book for recovery", () => {
    const book = new OrderBook(createSymbol("AAPL"));

    const restored = book.restoreOrder({
      orderId: createOrderId("ask-restored"),
      brokerId: createBrokerId("broker-1"),
      ownerDocument: createOwnerDocument("12345678900"),
      symbol: createSymbol("AAPL"),
      side: "ask",
      price: createPrice(10),
      originalQuantity: 100,
      remainingQuantity: 40,
      validUntil: createValidUntil("2026-01-01T15:00:00Z"),
      acceptedAt: createIsoTimestamp("2026-01-01T14:00:00Z")
    });

    expect(restored).toMatchObject({
      orderId: "ask-restored",
      status: "partially_filled",
      remainingQuantity: 40
    });
    expect(book.getBestAsk()).toMatchObject({
      orderId: "ask-restored",
      remainingQuantity: 40
    });
  });
});
