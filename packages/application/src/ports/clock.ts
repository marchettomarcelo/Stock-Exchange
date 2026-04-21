import type { IsoTimestamp } from "@decade/exchange-core";

export interface Clock {
  now(): IsoTimestamp;
}

