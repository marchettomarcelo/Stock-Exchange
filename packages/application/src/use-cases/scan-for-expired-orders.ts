import { expireOrderCommandSchema } from "@decade/contracts";

import type {
  Clock,
  CommandPublisher,
  IdGenerator,
  LeaseManager,
  Logger,
  OrderRepository
} from "../index";

export interface ScanForExpiredOrdersDependencies {
  leaseManager: LeaseManager;
  orderRepository: OrderRepository;
  commandPublisher: CommandPublisher;
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
  constructor(private readonly dependencies: ScanForExpiredOrdersDependencies) {}

  async execute(): Promise<ScanForExpiredOrdersResult> {
    const lease = await this.dependencies.leaseManager.tryAcquire(
      this.dependencies.leaseName ?? "expiration-scheduler"
    );

    if (lease === null) {
      return {
        acquired: false,
        published: 0
      };
    }

    try {
      const now = this.dependencies.clock.now();
      const dueOrders = await this.dependencies.orderRepository.listDueOrders(
        now,
        this.dependencies.limit ?? 100
      );

      for (const order of dueOrders) {
        await this.dependencies.commandPublisher.publish({
          topic: this.dependencies.commandsTopic,
          key: order.symbol,
          command: expireOrderCommandSchema.parse({
            command_id: this.dependencies.idGenerator.nextCommandId(),
            command_type: "ExpireOrder",
            order_id: order.orderId,
            symbol: order.symbol,
            expires_at: order.validUntil
          })
        });
      }

      this.dependencies.logger?.info("Expiration scan completed", {
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

