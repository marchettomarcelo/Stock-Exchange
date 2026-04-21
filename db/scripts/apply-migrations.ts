import { Client } from "pg";

import { applyMigrations } from "./migrations";

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL must be set to apply migrations");
  }

  return databaseUrl;
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString: getDatabaseUrl()
  });

  await client.connect();

  try {
    const applied = await applyMigrations(client);

    if (applied.length === 0) {
      console.info("No pending migrations");
      return;
    }

    console.info(`Applied migrations: ${applied.join(", ")}`);
  } finally {
    await client.end();
  }
}

void main();

