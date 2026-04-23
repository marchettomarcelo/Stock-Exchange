import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";

import type { PostgresPool } from "@decade/application";
import type { DisconnectablePublisher } from "@decade/infrastructure";

import { COMMAND_PUBLISHER, POSTGRES_POOL } from "./runtime.tokens";

@Injectable()
export class MatchingEngineRuntime implements OnApplicationShutdown {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: PostgresPool,
    @Inject(COMMAND_PUBLISHER) private readonly commandPublisher: DisconnectablePublisher
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.commandPublisher.disconnect();
    await this.pool.end?.();
  }
}
