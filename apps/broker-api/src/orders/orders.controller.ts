import {
  BadRequestException,
  Body,
  ConflictException,
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

import { ApplicationError, ConflictError, NotFoundError } from "@decade/application";
import type { GetOrderStatus, SubmitOrder } from "@decade/application";
import type { AcceptedOrderResponse, OrderStatusResponse } from "@decade/contracts";

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
    try {
      return await this.submitOrder.execute(body);
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

function toHttpError(error: unknown): Error {
  if (error instanceof BadRequestException) {
    return error;
  }

  if (isZodError(error)) {
    return new BadRequestException({
      message: "Invalid order submission request",
      issues: error.issues
    });
  }

  if (error instanceof Error && error.name === "DomainValidationError") {
    return new BadRequestException({
      message: error.message
    });
  }

  if (error instanceof NotFoundError) {
    return new NotFoundException(error.message);
  }

  if (error instanceof ConflictError) {
    return new ConflictException(error.message);
  }

  if (error instanceof ApplicationError) {
    return new InternalServerErrorException(error.message);
  }

  return error instanceof Error ? error : new Error(String(error));
}

function isZodError(error: unknown): error is { issues: unknown[] } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray(error.issues)
  );
}
