import type { Price } from "../primitives";
import type { OrderSide } from "../order-side";

export function isCrossingPrice(
  incomingSide: OrderSide,
  incomingPrice: Price,
  bestOppositePrice: Price
): boolean {
  return incomingSide === "bid"
    ? incomingPrice >= bestOppositePrice
    : incomingPrice <= bestOppositePrice;
}

