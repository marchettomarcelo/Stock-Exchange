import { describe, expect, it } from "vitest";

import type {
  Clock,
  CommandPublisher,
  IdGenerator,
  IdempotencyRepository,
  Lease,
  LeaseManager,
  OrderEventRepository,
  OrderRepository,
  ProcessedCommandRepository,
  RequestHasher,
  TradeRepository,
  TransactionContext,
  TransactionManager
} from "../index";
import {
  GetOrderStatus,
  ProcessExpireCommand,
  ProcessOrderCommand,
  ScanForExpiredOrders,
  SubmitOrder,
  SymbolOrderBooks,
  type DueOrderRecord,
  type IdempotencyRecord,
  type OrderEventRecord,
  type PersistedOrderRecord,
  type ProcessedCommandRecord,
  type RecoveryOrderRecord,
  type TradeRecord
} from "../index";
import {
  createBrokerId,
  createIsoTimestamp,
  createOrderId,
  createOwnerDocument,
  createPrice,
  createSymbol,
  createValidUntil
} from "@decade/exchange-core";

class FakeClock implements Clock {
  constructor(private current: string) {}

  now() {
    return createIsoTimestamp(this.current);
  }
}

class FakeIdGenerator implements IdGenerator {
  private orderCounter = 1;
  private commandCounter = 1;

  nextOrderId() {
    return `ord-${this.orderCounter++}`;
  }

  nextCommandId() {
    return `cmd-${this.commandCounter++}`;
  }
}

class FakeHasher implements RequestHasher {
  hash(value: unknown): string {
    return JSON.stringify(value);
  }
}

class FakePublisher implements CommandPublisher {
  readonly published: Array<{
    topic: string;
    key: string;
    command: unknown;
  }> = [];

  async publish(command: { topic: string; key: string; command: unknown }) {
    this.published.push(command);
  }
}

class FakeTransactionManager implements TransactionManager {
  async withTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: "transaction" });
  }
}

class InMemoryOrderRepository implements OrderRepository {
  readonly orders = new Map<string, PersistedOrderRecord>();
  private restingSequence = 1;

  async createAcceptedOrder(order: PersistedOrderRecord): Promise<void> {
    this.orders.set(order.orderId, { ...order });
  }

  async updateOrder(order: PersistedOrderRecord): Promise<void> {
    this.orders.set(order.orderId, { ...order });
  }

  async findOrderById(orderId: string): Promise<PersistedOrderRecord | null> {
    return this.orders.get(orderId) ?? null;
  }

  async listRestingOrdersForSymbol(symbol: string): Promise<RecoveryOrderRecord[]> {
    return [...this.orders.values()]
      .filter(
        (order) =>
          order.symbol === symbol &&
          (order.status === "open" || order.status === "partially_filled")
      )
      .sort((left, right) => (left.restingSequence ?? 0) - (right.restingSequence ?? 0))
      .map((order) => ({
        ...order,
        restingSequence: order.restingSequence ?? 0
      }));
  }

  async listDueOrders(asOf: string, limit: number): Promise<DueOrderRecord[]> {
    return [...this.orders.values()]
      .filter(
        (order) =>
          new Date(order.validUntil).getTime() <= new Date(asOf).getTime() &&
          (order.status === "accepted" ||
            order.status === "open" ||
            order.status === "partially_filled")
      )
      .slice(0, limit)
      .map((order) => ({
        orderId: order.orderId,
        symbol: order.symbol,
        validUntil: order.validUntil,
        status: order.status
      }));
  }

  async nextRestingSequence(): Promise<number> {
    return this.restingSequence++;
  }
}

class InMemoryIdempotencyRepository implements IdempotencyRepository {
  readonly keys = new Map<string, IdempotencyRecord>();

  async create(record: IdempotencyRecord): Promise<void> {
    this.keys.set(`${record.brokerId}:${record.idempotencyKey}`, record);
  }

  async findByBrokerAndKey(brokerId: string, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    return this.keys.get(`${brokerId}:${idempotencyKey}`) ?? null;
  }
}

class InMemoryTradeRepository implements TradeRepository {
  readonly trades: TradeRecord[] = [];

  async appendTrades(trades: TradeRecord[]): Promise<void> {
    this.trades.push(...trades);
  }

  async listTradesForOrder(orderId: string): Promise<TradeRecord[]> {
    return this.trades.filter(
      (trade) => trade.buyOrderId === orderId || trade.sellOrderId === orderId
    );
  }
}

class InMemoryOrderEventRepository implements OrderEventRepository {
  readonly events: OrderEventRecord[] = [];

  async appendEvents(events: OrderEventRecord[]): Promise<void> {
    this.events.push(...events);
  }

  async listEventsForOrder(orderId: string): Promise<OrderEventRecord[]> {
    return this.events.filter((event) => event.orderId === orderId);
  }
}

class InMemoryProcessedCommandRepository implements ProcessedCommandRepository {
  readonly processed = new Map<string, ProcessedCommandRecord>();

  async markProcessed(record: ProcessedCommandRecord): Promise<void> {
    this.processed.set(record.commandId, record);
  }

  async findByCommandId(commandId: string): Promise<ProcessedCommandRecord | null> {
    return this.processed.get(commandId) ?? null;
  }
}

class FakeLease implements Lease {
  released = false;

  constructor(public readonly name: string) {}

  async release(): Promise<void> {
    this.released = true;
  }
}

class FakeLeaseManager implements LeaseManager {
  lease: FakeLease | null = new FakeLease("expiration-scheduler");

  async tryAcquire(): Promise<Lease | null> {
    return this.lease;
  }
}

function seedOrder(
  repository: InMemoryOrderRepository,
  input: Partial<PersistedOrderRecord> & Pick<PersistedOrderRecord, "orderId">
) {
  repository.orders.set(input.orderId, {
    orderId: input.orderId,
    brokerId: input.brokerId ?? createBrokerId("broker-1"),
    ownerDocument: input.ownerDocument ?? createOwnerDocument("12345678900"),
    symbol: input.symbol ?? createSymbol("AAPL"),
    side: input.side ?? "bid",
    price: input.price ?? createPrice(100),
    originalQuantity: input.originalQuantity ?? 10,
    remainingQuantity: input.remainingQuantity ?? 10,
    status: input.status ?? "accepted",
    validUntil: input.validUntil ?? createValidUntil("2026-01-01T15:00:00Z"),
    acceptedAt: input.acceptedAt ?? createIsoTimestamp("2026-01-01T14:00:00Z"),
    updatedAt: input.updatedAt ?? createIsoTimestamp("2026-01-01T14:00:00Z"),
    restingSequence: input.restingSequence ?? null
  });
}

describe("application use cases", () => {
  it("accepts and publishes a new order, then reuses the response for idempotent retries", async () => {
    const orders = new InMemoryOrderRepository();
    const idempotency = new InMemoryIdempotencyRepository();
    const publisher = new FakePublisher();
    const useCase = new SubmitOrder({
      brokerId: "broker-1",
      orderRepository: orders,
      idempotencyRepository: idempotency,
      transactionManager: new FakeTransactionManager(),
      commandPublisher: publisher,
      idGenerator: new FakeIdGenerator(),
      requestHasher: new FakeHasher(),
      clock: new FakeClock("2026-01-01T14:00:00Z"),
      commandsTopic: "exchange.commands"
    });

    const request = {
      owner_document: "12345678900",
      side: "bid" as const,
      symbol: "AAPL",
      price: 100,
      quantity: 10,
      valid_until: "2026-01-01T15:00:00Z",
      idempotency_key: "idem-1"
    };

    const firstResponse = await useCase.execute(request);
    const secondResponse = await useCase.execute(request);

    expect(firstResponse).toEqual({
      order_id: "ord-1",
      status: "accepted",
      accepted_at: "2026-01-01T14:00:00.000Z"
    });
    expect(secondResponse).toEqual(firstResponse);
    expect(publisher.published).toHaveLength(1);
    expect(orders.orders.get("ord-1")?.status).toBe("accepted");
  });

  it("returns persisted order status for broker reads", async () => {
    const orders = new InMemoryOrderRepository();
    seedOrder(orders, {
      orderId: createOrderId("ord-1"),
      status: "partially_filled",
      remainingQuantity: 4
    });

    const response = await new GetOrderStatus({
      orderRepository: orders
    }).execute("ord-1");

    expect(response).toMatchObject({
      order_id: "ord-1",
      status: "partially_filled",
      remaining_quantity: 4
    });
  });

  it("processes a submit command, matches against the book, and persists trades and updates", async () => {
    const orders = new InMemoryOrderRepository();
    const trades = new InMemoryTradeRepository();
    const events = new InMemoryOrderEventRepository();
    const processedCommands = new InMemoryProcessedCommandRepository();
    const books = new SymbolOrderBooks();

    seedOrder(orders, {
      orderId: createOrderId("ask-1"),
      side: "ask",
      price: createPrice(10),
      originalQuantity: 100,
      remainingQuantity: 100,
      status: "open",
      restingSequence: 1
    });
    seedOrder(orders, {
      orderId: createOrderId("bid-1"),
      side: "bid",
      price: createPrice(10),
      originalQuantity: 100,
      remainingQuantity: 100,
      status: "accepted"
    });

    const result = await new ProcessOrderCommand({
      processedCommandRepository: processedCommands,
      orderRepository: orders,
      tradeRepository: trades,
      orderEventRepository: events,
      transactionManager: new FakeTransactionManager(),
      clock: new FakeClock("2026-01-01T14:00:05Z"),
      symbolBooks: books
    }).execute({
      command_id: "cmd-1",
      command_type: "SubmitOrder",
      order_id: "bid-1",
      broker_id: "broker-1",
      owner_document: "12345678900",
      side: "bid",
      symbol: "AAPL",
      price: 10,
      quantity: 100,
      valid_until: "2026-01-01T15:00:00Z",
      accepted_at: "2026-01-01T14:00:00Z"
    });

    expect(result).toEqual({
      status: "processed",
      orderId: "bid-1",
      finalStatus: "filled",
      trades: 1
    });
    expect(trades.trades).toEqual([
      expect.objectContaining({
        buyOrderId: "bid-1",
        sellOrderId: "ask-1",
        price: 10,
        quantity: 100
      })
    ]);
    expect(orders.orders.get("bid-1")?.status).toBe("filled");
    expect(orders.orders.get("ask-1")?.status).toBe("filled");
    expect(events.events).toHaveLength(2);
    expect(processedCommands.processed.has("cmd-1")).toBe(true);
  });

  it("processes an expire command for an accepted order", async () => {
    const orders = new InMemoryOrderRepository();
    const events = new InMemoryOrderEventRepository();
    const processedCommands = new InMemoryProcessedCommandRepository();
    seedOrder(orders, {
      orderId: createOrderId("ord-1"),
      status: "accepted",
      validUntil: createValidUntil("2026-01-01T14:00:00Z")
    });

    const result = await new ProcessExpireCommand({
      processedCommandRepository: processedCommands,
      orderRepository: orders,
      orderEventRepository: events,
      transactionManager: new FakeTransactionManager(),
      clock: new FakeClock("2026-01-01T14:00:01Z"),
      symbolBooks: new SymbolOrderBooks()
    }).execute({
      command_id: "cmd-expire-1",
      command_type: "ExpireOrder",
      order_id: "ord-1",
      symbol: "AAPL",
      expires_at: "2026-01-01T14:00:00Z"
    });

    expect(result).toEqual({
      status: "expired",
      orderId: "ord-1"
    });
    expect(orders.orders.get("ord-1")?.status).toBe("expired");
    expect(processedCommands.processed.has("cmd-expire-1")).toBe(true);
    expect(events.events).toHaveLength(1);
  });

  it("scans due orders and publishes expiration commands only when the lease is acquired", async () => {
    const orders = new InMemoryOrderRepository();
    const publisher = new FakePublisher();
    const leaseManager = new FakeLeaseManager();
    seedOrder(orders, {
      orderId: createOrderId("ord-1"),
      status: "open",
      restingSequence: 1,
      validUntil: createValidUntil("2026-01-01T14:00:00Z")
    });

    const result = await new ScanForExpiredOrders({
      leaseManager,
      orderRepository: orders,
      commandPublisher: publisher,
      idGenerator: new FakeIdGenerator(),
      clock: new FakeClock("2026-01-01T14:00:01Z"),
      commandsTopic: "exchange.commands"
    }).execute();

    expect(result).toEqual({
      acquired: true,
      published: 1
    });
    expect(publisher.published[0]).toEqual({
      topic: "exchange.commands",
      key: "AAPL",
      command: {
        command_id: "cmd-1",
        command_type: "ExpireOrder",
        order_id: "ord-1",
        symbol: "AAPL",
        expires_at: "2026-01-01T14:00:00.000Z"
      }
    });
    expect((leaseManager.lease as FakeLease).released).toBe(true);
  });
});
