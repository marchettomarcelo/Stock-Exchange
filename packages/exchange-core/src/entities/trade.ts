import type { IsoTimestamp, OrderId, Price, Symbol } from "../primitives";
import type { RestingOrder } from "./order";

export interface TradeExecution {
  symbol: Symbol;
  buyOrderId: OrderId;
  sellOrderId: OrderId;
  price: Price;
  quantity: number;
  executedAt: IsoTimestamp;
}

export function createTradeExecution(
  incomingOrder: RestingOrder,
  restingOrder: RestingOrder,
  quantity: number,
  executedAt: IsoTimestamp
): TradeExecution {
  const buyer = incomingOrder.side === "bid" ? incomingOrder : restingOrder;
  const seller = incomingOrder.side === "ask" ? incomingOrder : restingOrder;

  return {
    symbol: incomingOrder.symbol,
    buyOrderId: buyer.orderId,
    sellOrderId: seller.orderId,
    price: seller.price,
    quantity,
    executedAt
  };
}

