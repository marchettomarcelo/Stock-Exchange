import { z } from "zod";

import { orderSideValues, orderStatusValues, symbolPattern } from "@decade/exchange-core";

export const nonEmptyStringSchema = z.string().trim().min(1);
export const positiveIntegerSchema = z.number().int().positive();
export const isoTimestampSchema = z.string().datetime({ offset: true });
export const symbolSchema = nonEmptyStringSchema.regex(symbolPattern);
export const orderSideSchema = z.enum(orderSideValues);
export const orderStatusSchema = z.enum(orderStatusValues);

