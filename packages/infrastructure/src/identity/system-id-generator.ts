import { randomUUID } from "node:crypto";

import type { IdGenerator } from "@decade/application";

export class SystemIdGenerator implements IdGenerator {
  nextOrderId(): string {
    return `ord_${randomUUID()}`;
  }

  nextCommandId(): string {
    return `cmd_${randomUUID()}`;
  }
}
