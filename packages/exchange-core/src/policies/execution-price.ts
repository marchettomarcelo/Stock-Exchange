import type { Price } from "../primitives";
import type { RestingOrder } from "../entities/order";

export function getExecutionPrice(incomingOrder: RestingOrder, restingOrder: RestingOrder): Price {
  return incomingOrder.side === "ask" ? incomingOrder.price : restingOrder.price;
}

