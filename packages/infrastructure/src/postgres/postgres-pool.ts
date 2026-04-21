import { Pool } from "pg";

import type { DatabaseConfig } from "../config/app-config";
import type { PostgresPool } from "./postgres-types";

export function createPostgresPool(config: DatabaseConfig): PostgresPool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections
  }) as unknown as PostgresPool;
}

