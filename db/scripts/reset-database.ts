import { Client } from "pg";

import { applyMigrations, resetDatabase } from "./migrations";

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL must be set to reset the database");
  }

  return databaseUrl;
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString: getDatabaseUrl()
  });

  await client.connect();

  try {
    await resetDatabase(client);
    const applied = await applyMigrations(client);

    console.info(`Database reset complete. Applied migrations: ${applied.join(", ")}`);
  } finally {
    await client.end();
  }
}

void main();

