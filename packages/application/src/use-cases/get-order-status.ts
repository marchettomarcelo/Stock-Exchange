import type { OrderStatusResponse } from "@decade/contracts";
import { createOrderId } from "@decade/exchange-core";

import { NotFoundError } from "../errors";
import type { Logger } from "../ports/logger";
import type { PostgresOrderRepository } from "../postgres/postgres-order-repository";
import { toOrderStatusResponse } from "./helpers";

export interface GetOrderStatusServices {
  orders: PostgresOrderRepository;
  logger?: Logger;
}

export class GetOrderStatus {
  constructor(private readonly services: GetOrderStatusServices) {}

  async execute(orderId: string): Promise<OrderStatusResponse> {
    const order = await this.services.orders.findOrderById(createOrderId(orderId));

    if (order === null) {
      throw new NotFoundError(`Order ${orderId} was not found`);
    }

    this.services.logger?.debug("Order status fetched", {
      orderId: order.orderId,
      status: order.status
    });

    return toOrderStatusResponse(order);
  }
}
