import type { Clock } from "@decade/application";
import { createIsoTimestamp } from "@decade/exchange-core";

export class SystemClock implements Clock {
  now() {
    return createIsoTimestamp(new Date().toISOString());
  }
}

