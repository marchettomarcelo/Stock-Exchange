import { Module } from "@nestjs/common";

import { runtimeProviders } from "./runtime.providers";
import {
  APP_CONFIG,
  CLOCK,
  COMMAND_CONSUMER,
  COMMAND_PUBLISHER,
  ID_GENERATOR,
  LOGGER,
  POSTGRES_POOL,
  SYMBOL_ORDER_BOOKS
} from "./runtime.tokens";

@Module({
  providers: runtimeProviders,
  exports: [
    APP_CONFIG,
    CLOCK,
    COMMAND_CONSUMER,
    COMMAND_PUBLISHER,
    ID_GENERATOR,
    LOGGER,
    POSTGRES_POOL,
    SYMBOL_ORDER_BOOKS
  ]
})
export class RuntimeModule {}
