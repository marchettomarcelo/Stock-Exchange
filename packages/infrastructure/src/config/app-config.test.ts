import { describe, expect, it } from "vitest";

import { loadAppConfig } from "./app-config";

describe("loadAppConfig", () => {
  it("parses the runtime configuration from environment variables", () => {
    const config = loadAppConfig({
      DATABASE_URL: "postgres://localhost/decade",
      DATABASE_MAX_CONNECTIONS: "20",
      KAFKA_BROKERS: "broker-1:9092, broker-2:9092",
      KAFKA_CLIENT_ID: "matching-engine",
      KAFKA_CONSUMER_GROUP_ID: "matching-engine-workers",
      KAFKA_SSL: "true",
      KAFKA_COMMANDS_TOPIC: "commands",
      KAFKA_COMMANDS_PARTITIONS: "2",
      EXPIRATION_SCAN_INTERVAL_MS: "2500",
      EXPIRATION_SCAN_LIMIT: "500",
      EXPIRATION_LEASE_NAME: "expiration-loop",
      SERVICE_NAME: "matching-engine",
      LOG_LEVEL: "debug"
    });

    expect(config).toEqual({
      serviceName: "matching-engine",
      logLevel: "debug",
      database: {
        connectionString: "postgres://localhost/decade",
        maxConnections: 20
      },
      kafka: {
        brokers: ["broker-1:9092", "broker-2:9092"],
        clientId: "matching-engine",
        consumerGroupId: "matching-engine-workers",
        ssl: true,
        commandsTopic: "commands",
        commandsPartitions: 2
      },
      expiration: {
        scanIntervalMs: 2500,
        scanLimit: 500,
        leaseName: "expiration-loop"
      }
    });
  });
});
