import { OrderBook } from "@decade/exchange-core";
import type { RecoveryOrderRecord } from "./records";
import type { Symbol } from "@decade/exchange-core";

export class SymbolOrderBooks {
  private readonly books = new Map<string, OrderBook>();

  async getOrCreate(
    symbol: Symbol,
    loadOrders: () => Promise<RecoveryOrderRecord[]>
  ): Promise<OrderBook> {
    const existing = this.books.get(symbol);

    if (existing !== undefined) {
      return existing;
    }

    const book = new OrderBook(symbol);
    const orders = await loadOrders();

    for (const order of orders) {
      book.restoreOrder({
        orderId: order.orderId,
        brokerId: order.brokerId,
        ownerDocument: order.ownerDocument,
        symbol: order.symbol,
        side: order.side,
        price: order.price,
        originalQuantity: order.originalQuantity,
        remainingQuantity: order.remainingQuantity,
        validUntil: order.validUntil,
        acceptedAt: order.acceptedAt
      });
    }

    this.books.set(symbol, book);

    return book;
  }

  get(symbol: Symbol): OrderBook | null {
    return this.books.get(symbol) ?? null;
  }

  clear(symbol?: Symbol): void {
    if (symbol === undefined) {
      this.books.clear();
      return;
    }

    this.books.delete(symbol);
  }
}

