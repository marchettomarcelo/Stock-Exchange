import type { AcceptedOrderResponse, SubmitOrderRequest } from "@decade/contracts";
import { createBrokerId } from "@decade/exchange-core";
import type {
  CommandPublisher,
  Clock,
  IdGenerator,
  IdempotencyRepository,
  Logger,
  OrderRepository,
  RequestHasher,
  TransactionManager
} from "../index";

import {
  createAcceptedOrderRecord,
  createSubmitOrderCommand,
  parseSubmitOrderRequest,
  toAcceptedOrderResponse
} from "./helpers";
import { InvariantError } from "../errors";

export interface SubmitOrderDependencies {
  brokerId: string;
  orderRepository: OrderRepository;
  idempotencyRepository: IdempotencyRepository;
  transactionManager: TransactionManager;
  commandPublisher: CommandPublisher;
  idGenerator: IdGenerator;
  requestHasher: RequestHasher;
  clock: Clock;
  commandsTopic: string;
  logger?: Logger;
}

export class SubmitOrder {
  constructor(private readonly dependencies: SubmitOrderDependencies) {}

  async execute(request: SubmitOrderRequest): Promise<AcceptedOrderResponse> {
    const parsedRequest = parseSubmitOrderRequest(request);
    const brokerId = createBrokerId(this.dependencies.brokerId);
    const existing = await this.dependencies.idempotencyRepository.findByBrokerAndKey(
      brokerId,
      parsedRequest.idempotency_key
    );

    if (existing !== null) {
      const existingOrder = await this.dependencies.orderRepository.findOrderById(existing.orderId);

      if (existingOrder === null) {
        throw new InvariantError(
          `idempotency key ${parsedRequest.idempotency_key} points to a missing order`
        );
      }

      this.dependencies.logger?.info("Idempotent order submission reused", {
        brokerId,
        orderId: existingOrder.orderId
      });

      return toAcceptedOrderResponse(existingOrder);
    }

    const acceptedAt = this.dependencies.clock.now();
    const orderId = this.dependencies.idGenerator.nextOrderId();
    const commandId = this.dependencies.idGenerator.nextCommandId();
    const acceptedOrder = createAcceptedOrderRecord({
      orderId,
      brokerId,
      request: parsedRequest,
      acceptedAt
    });
    const command = createSubmitOrderCommand({
      commandId,
      orderId: acceptedOrder.orderId,
      brokerId,
      request: parsedRequest,
      acceptedAt
    });
    const requestHash = this.dependencies.requestHasher.hash(parsedRequest);

    await this.dependencies.transactionManager.withTransaction(async (context) => {
      await this.dependencies.orderRepository.createAcceptedOrder(acceptedOrder, context);
      await this.dependencies.idempotencyRepository.create(
        {
          brokerId: acceptedOrder.brokerId,
          idempotencyKey: parsedRequest.idempotency_key,
          orderId: acceptedOrder.orderId,
          requestHash,
          createdAt: acceptedAt
        },
        context
      );
    });

    await this.dependencies.commandPublisher.publish({
      topic: this.dependencies.commandsTopic,
      key: acceptedOrder.symbol,
      command
    });

    this.dependencies.logger?.info("Order accepted", {
      brokerId,
      orderId: acceptedOrder.orderId,
      symbol: acceptedOrder.symbol
    });

    return toAcceptedOrderResponse(acceptedOrder);
  }
}
