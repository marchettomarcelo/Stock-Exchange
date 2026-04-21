import { orderStatusValues } from "./constants";

export type OrderStatus = (typeof orderStatusValues)[number];

export function isOrderStatus(value: string): value is OrderStatus {
  return orderStatusValues.includes(value as OrderStatus);
}

