import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";

import type { Logger, ScanForExpiredOrders } from "@decade/application";
import type { AppConfig } from "@decade/infrastructure";

import {
  APP_CONFIG,
  LOGGER,
  SCAN_EXPIRED_ORDERS_USE_CASE
} from "../runtime/runtime.tokens";

@Injectable()
export class ExpirationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private inFlight: Promise<void> | null = null;

  constructor(
    @Inject(SCAN_EXPIRED_ORDERS_USE_CASE)
    private readonly scanForExpiredOrders: ScanForExpiredOrders,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly logger: Logger
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.scheduleNext(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    await this.inFlight;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopping) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    this.inFlight = this.runOnce();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;

      if (!this.stopping) {
        this.scheduleNext(this.config.expiration.scanIntervalMs);
      }
    }
  }

  private async runOnce(): Promise<void> {
    try {
      const result = await this.scanForExpiredOrders.execute();

      if (!result.acquired) {
        this.logger.debug("Expiration scan skipped because the lease was not acquired");
        return;
      }

      this.logger.info("Expiration scan cycle finished", {
        published: result.published
      });
    } catch (error) {
      this.logger.error("Expiration scan cycle failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
