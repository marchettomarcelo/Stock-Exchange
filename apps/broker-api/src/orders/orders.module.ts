import { Module } from "@nestjs/common";

import { OrdersController } from "./orders.controller";
import { runtimeProviders } from "../runtime/runtime.providers";

@Module({
  controllers: [OrdersController],
  providers: runtimeProviders
})
export class OrdersModule {}
