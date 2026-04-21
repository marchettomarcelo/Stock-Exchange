import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post
} from "@nestjs/common";

import { ApplicationError, NotFoundError } from "@decade/application";
import type { GetOrderStatus, SubmitOrder } from "@decade/application";
import type { AcceptedOrderResponse, OrderStatusResponse, SubmitOrderRequest } from "@decade/contracts";
import { submitOrderRequestSchema } from "@decade/contracts";

import { GET_ORDER_STATUS_USE_CASE, SUBMIT_ORDER_USE_CASE } from "../runtime/runtime.tokens";

@Controller("orders")
export class OrdersController {
  constructor(
    @Inject(SUBMIT_ORDER_USE_CASE) private readonly submitOrder: SubmitOrder,
    @Inject(GET_ORDER_STATUS_USE_CASE) private readonly getOrderStatus: GetOrderStatus
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(@Body() body: unknown): Promise<AcceptedOrderResponse> {
    const request = parseSubmitOrderRequest(body);

    try {
      return await this.submitOrder.execute(request);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Get(":orderId")
  async getStatus(@Param("orderId") orderId: string): Promise<OrderStatusResponse> {
    try {
      return await this.getOrderStatus.execute(orderId);
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

function parseSubmitOrderRequest(body: unknown): SubmitOrderRequest {
  const parsed = submitOrderRequestSchema.safeParse(body);

  if (!parsed.success) {
    throw new BadRequestException({
      message: "Invalid order submission request",
      issues: parsed.error.issues
    });
  }

  return parsed.data;
}

function toHttpError(error: unknown): Error {
  if (error instanceof BadRequestException) {
    return error;
  }

  if (error instanceof Error && error.name === "DomainValidationError") {
    return new BadRequestException({
      message: error.message
    });
  }

  if (error instanceof NotFoundError) {
    return new NotFoundException(error.message);
  }

  if (error instanceof ApplicationError) {
    return new InternalServerErrorException(error.message);
  }

  return error instanceof Error ? error : new Error(String(error));
}
