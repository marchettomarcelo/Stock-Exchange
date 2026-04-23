import { z } from "zod";

import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  orderSideSchema,
  orderStatusSchema,
  positiveIntegerSchema,
  symbolSchema
} from "./shared";

export const submitOrderRequestSchema = z.object({
  broker_id: nonEmptyStringSchema,
  owner_document: nonEmptyStringSchema,
  side: orderSideSchema,
  symbol: symbolSchema,
  price: positiveIntegerSchema,
  quantity: positiveIntegerSchema,
  valid_until: isoTimestampSchema,
  idempotency_key: nonEmptyStringSchema
});

export const acceptedOrderResponseSchema = z.object({
  order_id: nonEmptyStringSchema,
  status: z.literal("accepted"),
  accepted_at: isoTimestampSchema
});

export const orderStatusResponseSchema = z.object({
  order_id: nonEmptyStringSchema,
  broker_id: nonEmptyStringSchema,
  owner_document: nonEmptyStringSchema,
  side: orderSideSchema,
  symbol: symbolSchema,
  price: positiveIntegerSchema,
  original_quantity: positiveIntegerSchema,
  remaining_quantity: z.number().int().nonnegative(),
  status: orderStatusSchema,
  valid_until: isoTimestampSchema,
  accepted_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export type SubmitOrderRequest = z.infer<typeof submitOrderRequestSchema>;
export type AcceptedOrderResponse = z.infer<typeof acceptedOrderResponseSchema>;
export type OrderStatusResponse = z.infer<typeof orderStatusResponseSchema>;
