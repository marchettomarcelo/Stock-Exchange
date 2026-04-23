import type { AcceptedOrderResponse } from "@decade/contracts";
import { createBrokerId } from "@decade/exchange-core";

import {
  createAcceptedOrderRecord,
  createIdempotencyRecord,
  createSubmitOrderCommand,
  parseSubmitOrderRequest,
  recreateSubmitOrderCommand,
  toAcceptedOrderResponse
} from "./helpers";
import { ConflictError, InvariantError } from "../errors";
import type { KafkaCommandPublisher } from "../kafka/kafka-command-publisher";
import type { Clock } from "../ports/clock";
import type { IdGenerator, RequestHasher } from "../ports/identity";
import type { Logger } from "../ports/logger";
import type { PostgresIdempotencyRepository } from "../postgres/postgres-idempotency-repository";
import type { PostgresOrderRepository } from "../postgres/postgres-order-repository";
import type { PostgresTransactionManager } from "../postgres/postgres-transaction-manager";
import type { PersistedOrderRecord } from "../records";

type SubmissionAttempt =
  | {
      kind: "reused";
      order: PersistedOrderRecord;
    }
  | {
      kind: "publish";
      order: PersistedOrderRecord;
      command: ReturnType<typeof createSubmitOrderCommand>;
      idempotencyKey: string;
      logMessage: string;
    };

export interface SubmitOrderServices {
  orders: PostgresOrderRepository;
  idempotency: PostgresIdempotencyRepository;
  transactions: PostgresTransactionManager;
  commands: KafkaCommandPublisher;
  idGenerator: IdGenerator;
  requestHasher: RequestHasher;
  clock: Clock;
  commandsTopic: string;
  logger?: Logger;
}

export class SubmitOrder {
  constructor(private readonly services: SubmitOrderServices) {}

  async execute(request: unknown): Promise<AcceptedOrderResponse> {
    const parsedRequest = parseSubmitOrderRequest(request);
    const brokerId = createBrokerId(parsedRequest.broker_id);
    const requestHash = this.services.requestHasher.hash(parsedRequest);
    const attempt = await this.services.transactions.withTransaction<SubmissionAttempt>(
      async (context) => {
        const existing = await this.services.idempotency.findByBrokerAndKey(
          brokerId,
          parsedRequest.idempotency_key,
          context
        );

        if (existing !== null) {
          if (existing.requestHash !== requestHash) {
            throw new ConflictError(
              `idempotency key ${parsedRequest.idempotency_key} was already used for a different request`
            );
          }

          const existingOrder = await this.services.orders.findOrderById(existing.orderId, context);

          if (existingOrder === null) {
            throw new InvariantError(
              `idempotency key ${parsedRequest.idempotency_key} points to a missing order`
            );
          }

          if (existing.publishStatus === "published") {
            return {
              kind: "reused",
              order: existingOrder
            };
          }

          return {
            kind: "publish",
            order: existingOrder,
            command: recreateSubmitOrderCommand(existingOrder, existing),
            idempotencyKey: parsedRequest.idempotency_key,
            logMessage: "Order publish completed from pending idempotency record"
          };
        }

        const acceptedAt = this.services.clock.now();
        const orderId = this.services.idGenerator.nextOrderId();
        const commandId = this.services.idGenerator.nextCommandId();
        const acceptedOrder = createAcceptedOrderRecord({
          orderId,
          request: parsedRequest,
          acceptedAt
        });
        const command = createSubmitOrderCommand({
          commandId,
          orderId: acceptedOrder.orderId,
          request: parsedRequest,
          acceptedAt
        });

        await this.services.orders.createAcceptedOrder(acceptedOrder, context);
        await this.services.idempotency.create(
          createIdempotencyRecord({
            brokerId,
            idempotencyKey: parsedRequest.idempotency_key,
            order: acceptedOrder,
            commandId,
            requestHash,
            createdAt: acceptedAt
          }),
          context
        );

        return {
          kind: "publish",
          order: acceptedOrder,
          command,
          idempotencyKey: parsedRequest.idempotency_key,
          logMessage: "Order accepted"
        };
      }
    );

    if (attempt.kind === "reused") {
      this.services.logger?.info("Idempotent order submission reused", {
        brokerId,
        orderId: attempt.order.orderId
      });

      return toAcceptedOrderResponse(attempt.order);
    }

    await this.services.commands.publish({
      topic: this.services.commandsTopic,
      key: attempt.order.symbol,
      command: attempt.command
    });

    await this.services.idempotency.markPublished(
      brokerId,
      attempt.idempotencyKey,
      this.services.clock.now()
    );

    this.services.logger?.info(attempt.logMessage, {
      brokerId,
      orderId: attempt.order.orderId,
      symbol: attempt.order.symbol
    });

    return toAcceptedOrderResponse(attempt.order);
  }
}
