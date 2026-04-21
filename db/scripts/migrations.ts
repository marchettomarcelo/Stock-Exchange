import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface MigrationFile {
  name: string;
  sql: string;
}

const migrationFilePattern = /^\d+.*\.sql$/;

export function getMigrationsDirectory(): string {
  return path.resolve(process.cwd(), "db/migrations");
}

export async function loadMigrationFiles(
  directory = getMigrationsDirectory()
): Promise<MigrationFile[]> {
  const files = await readdir(directory);
  const migrationNames = files.filter((fileName) => migrationFilePattern.test(fileName)).sort();

  return Promise.all(
    migrationNames.map(async (name) => ({
      name,
      sql: await readFile(path.join(directory, name), "utf8")
    }))
  );
}

export async function ensureSchemaMigrationsTable(client: SqlClient): Promise<void> {
  const result = await client.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'schema_migrations'
  `);

  if (result.rows.length > 0) {
    return;
  }

  await client.query(`
    CREATE TABLE schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL
    )
  `);
}

export async function getAppliedMigrationNames(client: SqlClient): Promise<Set<string>> {
  await ensureSchemaMigrationsTable(client);

  const result = await client.query("SELECT name FROM schema_migrations ORDER BY name");

  return new Set(
    result.rows.map((row) => {
      const migration = row as { name: string };
      return migration.name;
    })
  );
}

export async function applyMigrations(
  client: SqlClient,
  directory = getMigrationsDirectory()
): Promise<string[]> {
  const migrations = await loadMigrationFiles(directory);
  const appliedNames = await getAppliedMigrationNames(client);
  const appliedThisRun: string[] = [];

  for (const migration of migrations) {
    if (appliedNames.has(migration.name)) {
      continue;
    }

    await client.query("BEGIN");

    try {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [
        migration.name,
        new Date().toISOString()
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    appliedThisRun.push(migration.name);
  }

  return appliedThisRun;
}

export async function resetDatabase(client: SqlClient): Promise<void> {
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
}
