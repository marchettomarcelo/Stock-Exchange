import type { OrderId, Price } from "../primitives";
import type { RestingOrder } from "../entities/order";

export class PriceLevel {
  private readonly orders: RestingOrder[] = [];

  constructor(public readonly price: Price) {}

  append(order: RestingOrder): void {
    this.orders.push(order);
  }

  peek(): RestingOrder | undefined {
    return this.orders[0];
  }

  shift(): RestingOrder | undefined {
    return this.orders.shift();
  }

  remove(orderId: OrderId): RestingOrder | undefined {
    const index = this.orders.findIndex((order) => order.orderId === orderId);

    if (index === -1) {
      return undefined;
    }

    const [removedOrder] = this.orders.splice(index, 1);

    return removedOrder;
  }

  isEmpty(): boolean {
    return this.orders.length === 0;
  }

  toArray(): RestingOrder[] {
    return [...this.orders];
  }
}

