import { z } from "zod";

import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  orderSideSchema,
  positiveIntegerSchema,
  symbolSchema
} from "./shared";

export const submitOrderCommandSchema = z.object({
  command_id: nonEmptyStringSchema,
  command_type: z.literal("SubmitOrder"),
  order_id: nonEmptyStringSchema,
  broker_id: nonEmptyStringSchema,
  owner_document: nonEmptyStringSchema,
  side: orderSideSchema,
  symbol: symbolSchema,
  price: positiveIntegerSchema,
  quantity: positiveIntegerSchema,
  valid_until: isoTimestampSchema,
  accepted_at: isoTimestampSchema
});

export const expireOrderCommandSchema = z.object({
  command_id: nonEmptyStringSchema,
  command_type: z.literal("ExpireOrder"),
  order_id: nonEmptyStringSchema,
  symbol: symbolSchema,
  expires_at: isoTimestampSchema
});

export type SubmitOrderCommand = z.infer<typeof submitOrderCommandSchema>;
export type ExpireOrderCommand = z.infer<typeof expireOrderCommandSchema>;

