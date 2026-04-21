import { orderSideValues } from "./constants";

export type OrderSide = (typeof orderSideValues)[number];

export function isOrderSide(value: string): value is OrderSide {
  return orderSideValues.includes(value as OrderSide);
}

