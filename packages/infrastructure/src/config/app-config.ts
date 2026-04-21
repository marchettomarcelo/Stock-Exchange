import { z } from "zod";

const booleanSchema = z
  .union([z.boolean(), z.string()])
  .transform((value: boolean | string) => {
    if (typeof value === "boolean") {
      return value;
    }

    return value === "true";
  });

const envSchema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
  KAFKA_BROKERS: z.string().trim().min(1),
  KAFKA_CLIENT_ID: z.string().trim().min(1).default("decade"),
  KAFKA_CONSUMER_GROUP_ID: z.string().trim().min(1).optional(),
  KAFKA_SSL: booleanSchema.default(false),
  KAFKA_COMMANDS_TOPIC: z.string().trim().min(1).default("exchange.commands"),
  KAFKA_COMMANDS_PARTITIONS: z.coerce.number().int().positive().default(1),
  EXPIRATION_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  EXPIRATION_SCAN_LIMIT: z.coerce.number().int().positive().default(100),
  EXPIRATION_LEASE_NAME: z.string().trim().min(1).default("expiration-scheduler"),
  SERVICE_NAME: z.string().trim().min(1).default("decade"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export interface DatabaseConfig {
  connectionString: string;
  maxConnections: number;
}

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  consumerGroupId: string;
  ssl: boolean;
  commandsTopic: string;
  commandsPartitions: number;
}

export interface AppConfig {
  serviceName: string;
  logLevel: "debug" | "info" | "warn" | "error";
  database: DatabaseConfig;
  kafka: KafkaConfig;
  expiration: {
    scanIntervalMs: number;
    scanLimit: number;
    leaseName: string;
  };
}

export function loadAppConfig(
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    serviceName: parsed.SERVICE_NAME,
    logLevel: parsed.LOG_LEVEL,
    database: {
      connectionString: parsed.DATABASE_URL,
      maxConnections: parsed.DATABASE_MAX_CONNECTIONS
    },
    kafka: {
      brokers: parsed.KAFKA_BROKERS.split(",")
        .map((broker: string) => broker.trim())
        .filter(Boolean),
      clientId: parsed.KAFKA_CLIENT_ID,
      consumerGroupId: parsed.KAFKA_CONSUMER_GROUP_ID ?? parsed.SERVICE_NAME,
      ssl: parsed.KAFKA_SSL,
      commandsTopic: parsed.KAFKA_COMMANDS_TOPIC,
      commandsPartitions: parsed.KAFKA_COMMANDS_PARTITIONS
    },
    expiration: {
      scanIntervalMs: parsed.EXPIRATION_SCAN_INTERVAL_MS,
      scanLimit: parsed.EXPIRATION_SCAN_LIMIT,
      leaseName: parsed.EXPIRATION_LEASE_NAME
    }
  };
}
