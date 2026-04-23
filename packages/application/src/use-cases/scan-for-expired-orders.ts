import { expireOrderCommandSchema } from "@decade/contracts";

import type { KafkaCommandPublisher } from "../kafka/kafka-command-publisher";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/identity";
import type { Logger } from "../ports/logger";
import type { PostgresAdvisoryLockManager } from "../postgres/postgres-advisory-lock-manager";
import type { PostgresOrderRepository } from "../postgres/postgres-order-repository";

export interface ScanForExpiredOrdersServices {
  leaseManager: PostgresAdvisoryLockManager;
  orders: PostgresOrderRepository;
  commands: KafkaCommandPublisher;
  idGenerator: IdGenerator;
  clock: Clock;
  commandsTopic: string;
  limit?: number;
  leaseName?: string;
  logger?: Logger;
}

export interface ScanForExpiredOrdersResult {
  acquired: boolean;
  published: number;
}

export class ScanForExpiredOrders {
  constructor(private readonly services: ScanForExpiredOrdersServices) {}

  async execute(): Promise<ScanForExpiredOrdersResult> {
    const lease = await this.services.leaseManager.tryAcquire(
      this.services.leaseName ?? "expiration-scheduler"
    );

    if (lease === null) {
      return {
        acquired: false,
        published: 0
      };
    }

    try {
      const now = this.services.clock.now();
      const dueOrders = await this.services.orders.listDueOrders(
        now,
        this.services.limit ?? 100
      );

      for (const order of dueOrders) {
        await this.services.commands.publish({
          topic: this.services.commandsTopic,
          key: order.symbol,
          command: expireOrderCommandSchema.parse({
            command_id: this.services.idGenerator.nextCommandId(),
            command_type: "ExpireOrder",
            order_id: order.orderId,
            symbol: order.symbol,
            expires_at: order.validUntil
          })
        });
      }

      this.services.logger?.info("Expiration scan completed", {
        published: dueOrders.length
      });

      return {
        acquired: true,
        published: dueOrders.length
      };
    } finally {
      await lease.release();
    }
  }
}
