import { describe, expect, it } from "vitest";

import type {
  Clock,
  IdGenerator,
  KafkaCommandPublisher,
  PostgresAdvisoryLockManager,
  PostgresIdempotencyRepository,
  PostgresOrderEventRepository,
  PostgresOrderRepository,
  PostgresProcessedCommandRepository,
  PostgresTransactionContext,
  PostgresTransactionManager,
  PostgresTradeRepository,
  RequestHasher
} from "../index";
import {
  ConflictError,
  GetOrderStatus,
  ProcessExpireCommand,
  ProcessOrderCommand,
  ScanForExpiredOrders,
  SubmitOrder,
  SymbolOrderBooks,
  type DueOrderRecord,
  type IdempotencyRecord,
  type Lease,
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

class FakePublisher {
  readonly published: Array<{
    topic: string;
    key: string;
    command: unknown;
  }> = [];
  failuresRemaining = 0;
  error: Error = new Error("publish failed");

  failNext(times = 1, error = new Error("publish failed")): void {
    this.failuresRemaining = times;
    this.error = error;
  }

  async publish(command: { topic: string; key: string; command: unknown }) {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw this.error;
    }

    this.published.push(command);
  }
}

class FakeTransactionManager {
  async withTransaction<T>(
    work: (context: PostgresTransactionContext) => Promise<T>
  ): Promise<T> {
    return work({ kind: "transaction" } as PostgresTransactionContext);
  }
}

class InMemoryOrderRepository {
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

class InMemoryIdempotencyRepository {
  readonly keys = new Map<string, IdempotencyRecord>();

  async create(record: IdempotencyRecord): Promise<void> {
    this.keys.set(`${record.brokerId}:${record.idempotencyKey}`, { ...record });
  }

  async findByBrokerAndKey(
    brokerId: string,
    idempotencyKey: string
  ): Promise<IdempotencyRecord | null> {
    return this.keys.get(`${brokerId}:${idempotencyKey}`) ?? null;
  }

  async markPublished(
    brokerId: string,
    idempotencyKey: string,
    publishedAt: string
  ): Promise<void> {
    const key = `${brokerId}:${idempotencyKey}`;
    const record = this.keys.get(key);

    if (record === undefined) {
      return;
    }

    this.keys.set(key, {
      ...record,
      publishStatus: "published",
      publishedAt
    });
  }
}

class InMemoryTradeRepository {
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

class InMemoryOrderEventRepository {
  readonly events: OrderEventRecord[] = [];

  async appendEvents(events: OrderEventRecord[]): Promise<void> {
    this.events.push(...events);
  }

  async listEventsForOrder(orderId: string): Promise<OrderEventRecord[]> {
    return this.events.filter((event) => event.orderId === orderId);
  }
}

class InMemoryProcessedCommandRepository {
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

class FakeLeaseManager {
  lease: FakeLease | null = new FakeLease("expiration-scheduler");

  async tryAcquire(): Promise<Lease | null> {
    return this.lease;
  }
}

function asOrdersStore(repository: InMemoryOrderRepository): PostgresOrderRepository {
  return repository as unknown as PostgresOrderRepository;
}

function asIdempotencyStore(
  repository: InMemoryIdempotencyRepository
): PostgresIdempotencyRepository {
  return repository as unknown as PostgresIdempotencyRepository;
}

function asTradesStore(repository: InMemoryTradeRepository): PostgresTradeRepository {
  return repository as unknown as PostgresTradeRepository;
}

function asEventsStore(
  repository: InMemoryOrderEventRepository
): PostgresOrderEventRepository {
  return repository as unknown as PostgresOrderEventRepository;
}

function asProcessedCommandsStore(
  repository: InMemoryProcessedCommandRepository
): PostgresProcessedCommandRepository {
  return repository as unknown as PostgresProcessedCommandRepository;
}

function asTransactionManager(manager: FakeTransactionManager): PostgresTransactionManager {
  return manager as unknown as PostgresTransactionManager;
}

function asPublisher(publisher: FakePublisher): KafkaCommandPublisher {
  return publisher as unknown as KafkaCommandPublisher;
}

function asLeaseManager(manager: FakeLeaseManager): PostgresAdvisoryLockManager {
  return manager as unknown as PostgresAdvisoryLockManager;
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
      orders: asOrdersStore(orders),
      idempotency: asIdempotencyStore(idempotency),
      transactions: asTransactionManager(new FakeTransactionManager()),
      commands: asPublisher(publisher),
      idGenerator: new FakeIdGenerator(),
      requestHasher: new FakeHasher(),
      clock: new FakeClock("2026-01-01T14:00:00Z"),
      commandsTopic: "exchange.commands"
    });

    const request = {
      broker_id: "broker-1",
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
    expect(idempotency.keys.get("broker-1:idem-1")).toEqual(
      expect.objectContaining({
        orderId: "ord-1",
        commandId: "cmd-1",
        symbol: "AAPL",
        publishStatus: "published"
      })
    );
  });

  it("rejects reusing an idempotency key with a different request payload", async () => {
    const orders = new InMemoryOrderRepository();
    const idempotency = new InMemoryIdempotencyRepository();
    const publisher = new FakePublisher();
    const useCase = new SubmitOrder({
      orders: asOrdersStore(orders),
      idempotency: asIdempotencyStore(idempotency),
      transactions: asTransactionManager(new FakeTransactionManager()),
      commands: asPublisher(publisher),
      idGenerator: new FakeIdGenerator(),
      requestHasher: new FakeHasher(),
      clock: new FakeClock("2026-01-01T14:00:00Z"),
      commandsTopic: "exchange.commands"
    });

    await useCase.execute({
      broker_id: "broker-1",
      owner_document: "12345678900",
      side: "bid",
      symbol: "AAPL",
      price: 100,
      quantity: 10,
      valid_until: "2026-01-01T15:00:00Z",
      idempotency_key: "idem-1"
    });

    await expect(
      useCase.execute({
        broker_id: "broker-1",
        owner_document: "12345678900",
        side: "ask",
        symbol: "AAPL",
        price: 100,
        quantity: 10,
        valid_until: "2026-01-01T15:00:00Z",
        idempotency_key: "idem-1"
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(publisher.published).toHaveLength(1);
  });

  it("republishes a pending idempotent order after a publish failure", async () => {
    const orders = new InMemoryOrderRepository();
    const idempotency = new InMemoryIdempotencyRepository();
    const publisher = new FakePublisher();
    publisher.failNext(1);

    const useCase = new SubmitOrder({
      orders: asOrdersStore(orders),
      idempotency: asIdempotencyStore(idempotency),
      transactions: asTransactionManager(new FakeTransactionManager()),
      commands: asPublisher(publisher),
      idGenerator: new FakeIdGenerator(),
      requestHasher: new FakeHasher(),
      clock: new FakeClock("2026-01-01T14:00:00Z"),
      commandsTopic: "exchange.commands"
    });

    const request = {
      broker_id: "broker-1",
      owner_document: "12345678900",
      side: "bid" as const,
      symbol: "AAPL",
      price: 100,
      quantity: 10,
      valid_until: "2026-01-01T15:00:00Z",
      idempotency_key: "idem-1"
    };

    await expect(useCase.execute(request)).rejects.toThrow("publish failed");
    expect(orders.orders.get("ord-1")?.status).toBe("accepted");
    expect(idempotency.keys.get("broker-1:idem-1")).toEqual(
      expect.objectContaining({
        orderId: "ord-1",
        commandId: "cmd-1",
        publishStatus: "pending",
        publishedAt: null
      })
    );

    const retryResponse = await useCase.execute(request);

    expect(retryResponse).toEqual({
      order_id: "ord-1",
      status: "accepted",
      accepted_at: "2026-01-01T14:00:00.000Z"
    });
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]).toEqual({
      topic: "exchange.commands",
      key: "AAPL",
      command: {
        command_id: "cmd-1",
        command_type: "SubmitOrder",
        order_id: "ord-1",
        broker_id: "broker-1",
        owner_document: "12345678900",
        side: "bid",
        symbol: "AAPL",
        price: 100,
        quantity: 10,
        valid_until: "2026-01-01T15:00:00.000Z",
        accepted_at: "2026-01-01T14:00:00.000Z"
      }
    });
    expect(idempotency.keys.get("broker-1:idem-1")).toEqual(
      expect.objectContaining({
        publishStatus: "published",
        publishedAt: "2026-01-01T14:00:00.000Z"
      })
    );
  });

  it("scopes idempotency by request broker_id", async () => {
    const orders = new InMemoryOrderRepository();
    const idempotency = new InMemoryIdempotencyRepository();
    const publisher = new FakePublisher();
    const useCase = new SubmitOrder({
      orders: asOrdersStore(orders),
      idempotency: asIdempotencyStore(idempotency),
      transactions: asTransactionManager(new FakeTransactionManager()),
      commands: asPublisher(publisher),
      idGenerator: new FakeIdGenerator(),
      requestHasher: new FakeHasher(),
      clock: new FakeClock("2026-01-01T14:00:00Z"),
      commandsTopic: "exchange.commands"
    });

    const firstResponse = await useCase.execute({
      broker_id: "broker-1",
      owner_document: "12345678900",
      side: "bid",
      symbol: "AAPL",
      price: 100,
      quantity: 10,
      valid_until: "2026-01-01T15:00:00Z",
      idempotency_key: "idem-1"
    });

    const secondResponse = await useCase.execute({
      broker_id: "broker-2",
      owner_document: "12345678900",
      side: "bid",
      symbol: "AAPL",
      price: 100,
      quantity: 10,
      valid_until: "2026-01-01T15:00:00Z",
      idempotency_key: "idem-1"
    });

    expect(firstResponse.order_id).toBe("ord-1");
    expect(secondResponse.order_id).toBe("ord-2");
    expect(orders.orders.get("ord-1")?.brokerId).toBe("broker-1");
    expect(orders.orders.get("ord-2")?.brokerId).toBe("broker-2");
    expect(publisher.published).toEqual([
      expect.objectContaining({
        command: expect.objectContaining({
          broker_id: "broker-1"
        })
      }),
      expect.objectContaining({
        command: expect.objectContaining({
          broker_id: "broker-2"
        })
      })
    ]);
  });

  it("returns persisted order status for broker reads", async () => {
    const orders = new InMemoryOrderRepository();
    seedOrder(orders, {
      orderId: createOrderId("ord-1"),
      status: "partially_filled",
      remainingQuantity: 4
    });

    const response = await new GetOrderStatus({
      orders: asOrdersStore(orders)
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
      processedCommands: asProcessedCommandsStore(processedCommands),
      orders: asOrdersStore(orders),
      trades: asTradesStore(trades),
      orderEvents: asEventsStore(events),
      transactions: asTransactionManager(new FakeTransactionManager()),
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
      processedCommands: asProcessedCommandsStore(processedCommands),
      orders: asOrdersStore(orders),
      orderEvents: asEventsStore(events),
      transactions: asTransactionManager(new FakeTransactionManager()),
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
      leaseManager: asLeaseManager(leaseManager),
      orders: asOrdersStore(orders),
      commands: asPublisher(publisher),
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
