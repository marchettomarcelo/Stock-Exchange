import type { OrderStatusResponse } from "@decade/contracts";
import { createOrderId } from "@decade/exchange-core";

import type { Logger, OrderRepository } from "../index";
import { NotFoundError } from "../errors";
import { toOrderStatusResponse } from "./helpers";

export interface GetOrderStatusDependencies {
  orderRepository: OrderRepository;
  logger?: Logger;
}

export class GetOrderStatus {
  constructor(private readonly dependencies: GetOrderStatusDependencies) {}

  async execute(orderId: string): Promise<OrderStatusResponse> {
    const order = await this.dependencies.orderRepository.findOrderById(createOrderId(orderId));

    if (order === null) {
      throw new NotFoundError(`Order ${orderId} was not found`);
    }

    this.dependencies.logger?.debug("Order status fetched", {
      orderId: order.orderId,
      status: order.status
    });

    return toOrderStatusResponse(order);
  }
}

