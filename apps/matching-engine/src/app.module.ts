import { Module } from "@nestjs/common";

import { EngineModule } from "./engine/engine.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [EngineModule],
  controllers: [HealthController]
})
export class AppModule {}
