import { DomainValidationError } from "../errors";
import type { TradeExecution } from "../entities/trade";
import { createTradeExecution } from "../entities/trade";
import {
  createRestingOrder,
  createRestoredOrder,
  isOrderExpired,
  toExpiredOrderSnapshot,
  toExpiredRestingOrderSnapshot,
  toOrderSnapshot,
  type OrderInput,
  type OrderSnapshot,
  type RestoredOrderInput,
  type RestingOrder
} from "../entities/order";
import { isCrossingPrice } from "../matching/match-order";
import { PriceLevel } from "./price-level";
import type { IsoTimestamp, OrderId, Symbol } from "../primitives";
import { getExecutionPrice } from "../policies/execution-price";

type SideBook = {
  levels: Map<number, PriceLevel>;
  prices: number[];
};

function cloneSnapshots(updates: Map<string, OrderSnapshot>): OrderSnapshot[] {
  return [...updates.values()];
}

function insertPrice(prices: number[], price: number, descending: boolean): void {
  if (prices.includes(price)) {
    return;
  }

  const insertIndex = prices.findIndex((currentPrice) =>
    descending ? price > currentPrice : price < currentPrice
  );

  if (insertIndex === -1) {
    prices.push(price);
    return;
  }

  prices.splice(insertIndex, 0, price);
}

function removePrice(prices: number[], price: number): void {
  const index = prices.indexOf(price);

  if (index !== -1) {
    prices.splice(index, 1);
  }
}

export interface PlaceOrderResult {
  order: OrderSnapshot;
  trades: TradeExecution[];
  updates: OrderSnapshot[];
}

export class OrderBook {
  private readonly bids: SideBook = {
    levels: new Map(),
    prices: []
  };

  private readonly asks: SideBook = {
    levels: new Map(),
    prices: []
  };

  private readonly liveOrders = new Map<string, RestingOrder>();
  private readonly orderLocations = new Map<string, { side: "bid" | "ask"; price: number }>();

  constructor(public readonly symbol: Symbol) {}

  placeOrder(input: OrderInput, processedAt: IsoTimestamp): PlaceOrderResult {
    this.ensureOrderBelongsToBook(input.symbol);

    if (this.liveOrders.has(input.orderId)) {
      throw new DomainValidationError(`order_id ${input.orderId} already exists in the book`);
    }

    if (isOrderExpired(input.validUntil, processedAt)) {
      const expiredOrder = toExpiredOrderSnapshot(input);

      return {
        order: expiredOrder,
        trades: [],
        updates: [expiredOrder]
      };
    }

    const incomingOrder = createRestingOrder(input);
    const trades: TradeExecution[] = [];
    const updates = new Map<string, OrderSnapshot>();

    while (incomingOrder.remainingQuantity > 0) {
      const bestOpposite = this.getBestOppositeOrder(incomingOrder.side);

      if (bestOpposite === undefined) {
        break;
      }

      if (!isCrossingPrice(incomingOrder.side, incomingOrder.price, bestOpposite.price)) {
        break;
      }

      const tradeQuantity = Math.min(
        incomingOrder.remainingQuantity,
        bestOpposite.remainingQuantity
      );

      incomingOrder.remainingQuantity -= tradeQuantity;
      bestOpposite.remainingQuantity -= tradeQuantity;

      trades.push({
        ...createTradeExecution(incomingOrder, bestOpposite, tradeQuantity, processedAt),
        price: getExecutionPrice(incomingOrder, bestOpposite)
      });

      updates.set(bestOpposite.orderId, toOrderSnapshot(bestOpposite));

      if (bestOpposite.remainingQuantity === 0) {
        this.removeLiveOrder(bestOpposite.orderId);
      }
    }

    if (incomingOrder.remainingQuantity > 0) {
      this.addLiveOrder(incomingOrder);
    }

    const incomingSnapshot = toOrderSnapshot(incomingOrder);
    updates.set(incomingOrder.orderId, incomingSnapshot);

    return {
      order: incomingSnapshot,
      trades,
      updates: cloneSnapshots(updates)
    };
  }

  restoreOrder(input: RestoredOrderInput): OrderSnapshot {
    this.ensureOrderBelongsToBook(input.symbol);

    if (this.liveOrders.has(input.orderId)) {
      throw new DomainValidationError(`order_id ${input.orderId} already exists in the book`);
    }

    const restoredOrder = createRestoredOrder(input);

    this.addLiveOrder(restoredOrder);

    return toOrderSnapshot(restoredOrder);
  }

  expireOrder(orderId: OrderId, processedAt: IsoTimestamp): OrderSnapshot | null {
    const order = this.liveOrders.get(orderId);

    if (order === undefined) {
      return null;
    }

    if (!isOrderExpired(order.validUntil, processedAt)) {
      return null;
    }

    this.removeLiveOrder(orderId);

    return toExpiredRestingOrderSnapshot(order);
  }

  hasOrder(orderId: OrderId): boolean {
    return this.liveOrders.has(orderId);
  }

  getOrder(orderId: OrderId): OrderSnapshot | null {
    const order = this.liveOrders.get(orderId);

    return order === undefined ? null : toOrderSnapshot(order);
  }

  getOpenOrders(): OrderSnapshot[] {
    return this.getOrdersForSide("ask").concat(this.getOrdersForSide("bid"));
  }

  getBestBid(): OrderSnapshot | null {
    return this.getBestOrder("bid");
  }

  getBestAsk(): OrderSnapshot | null {
    return this.getBestOrder("ask");
  }

  private getBestOrder(side: "bid" | "ask"): OrderSnapshot | null {
    const sideBook = side === "bid" ? this.bids : this.asks;
    const bestPrice = sideBook.prices[0];

    if (bestPrice === undefined) {
      return null;
    }

    const level = sideBook.levels.get(bestPrice);
    const order = level?.peek();

    return order === undefined ? null : toOrderSnapshot(order);
  }

  private getBestOppositeOrder(side: "bid" | "ask"): RestingOrder | undefined {
    const oppositeBook = side === "bid" ? this.asks : this.bids;
    const bestPrice = oppositeBook.prices[0];

    if (bestPrice === undefined) {
      return undefined;
    }

    return oppositeBook.levels.get(bestPrice)?.peek();
  }

  private getOrdersForSide(side: "bid" | "ask"): OrderSnapshot[] {
    const sideBook = side === "bid" ? this.bids : this.asks;
    const orders: OrderSnapshot[] = [];

    for (const price of sideBook.prices) {
      const level = sideBook.levels.get(price);

      if (level === undefined) {
        continue;
      }

      for (const order of level.toArray()) {
        orders.push(toOrderSnapshot(order));
      }
    }

    return orders;
  }

  private addLiveOrder(order: RestingOrder): void {
    const sideBook = order.side === "bid" ? this.bids : this.asks;
    const numericPrice = Number(order.price);
    let level = sideBook.levels.get(numericPrice);

    if (level === undefined) {
      level = new PriceLevel(order.price);
      sideBook.levels.set(numericPrice, level);
      insertPrice(sideBook.prices, numericPrice, order.side === "bid");
    }

    level.append(order);
    this.liveOrders.set(order.orderId, order);
    this.orderLocations.set(order.orderId, {
      side: order.side,
      price: numericPrice
    });
  }

  private removeLiveOrder(orderId: OrderId): void {
    const location = this.orderLocations.get(orderId);

    if (location === undefined) {
      return;
    }

    const sideBook = location.side === "bid" ? this.bids : this.asks;
    const level = sideBook.levels.get(location.price);

    if (level === undefined) {
      return;
    }

    level.remove(orderId);

    if (level.isEmpty()) {
      sideBook.levels.delete(location.price);
      removePrice(sideBook.prices, location.price);
    }

    this.liveOrders.delete(orderId);
    this.orderLocations.delete(orderId);
  }

  private ensureOrderBelongsToBook(symbol: Symbol): void {
    if (symbol !== this.symbol) {
      throw new DomainValidationError(
        `order symbol ${symbol} does not belong to book ${this.symbol}`
      );
    }
  }
}
