import path from "node:path";

import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";

import { applyMigrations, getAppliedMigrationNames } from "./migrations";

const migrationsDirectory = path.resolve(process.cwd(), "db/migrations");

describe("database migrations", () => {
  let client: InstanceType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Client"];

  beforeEach(async () => {
    const db = newDb();

    db.public.registerFunction({
      name: "char_length",
      args: ["text"],
      returns: "int4",
      implementation: (value: string) => value.length
    });
    db.public.registerFunction({
      name: "translate",
      args: ["text", "text", "text"],
      returns: "text",
      implementation: (value: string, from: string, to: string) => {
        const replacementMap = new Map<string, string>();

        for (const [index, char] of [...from].entries()) {
          replacementMap.set(char, to[index] ?? "");
        }

        return [...value]
          .map((char) => replacementMap.get(char) ?? char)
          .join("");
      }
    });

    const pg = db.adapters.createPg();

    client = new pg.Client();
    await client.connect();
  });

  it("applies the initial schema and records the migration", async () => {
    const applied = await applyMigrations(client, migrationsDirectory);
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    expect(applied).toEqual(["0001_initial_schema.sql"]);
    expect(tables.rows.map((row) => (row as { table_name: string }).table_name)).toEqual([
      "idempotency_keys",
      "order_events",
      "orders",
      "processed_commands",
      "schema_migrations",
      "trades"
    ]);
  });

  it("does not reapply migrations that were already recorded", async () => {
    await applyMigrations(client, migrationsDirectory);

    const reapplied = await applyMigrations(client, migrationsDirectory);
    const appliedNames = await getAppliedMigrationNames(client);

    expect(reapplied).toEqual([]);
    expect([...appliedNames]).toEqual(["0001_initial_schema.sql"]);
  });

  it("enforces the core quantity and symbol constraints", async () => {
    await applyMigrations(client, migrationsDirectory);

    await expect(
      client.query(`
        INSERT INTO orders (
          order_id,
          broker_id,
          owner_document,
          symbol,
          side,
          price,
          original_quantity,
          remaining_quantity,
          status,
          valid_until,
          accepted_at,
          updated_at
        ) VALUES (
          'ord-1',
          'broker-1',
          '12345678900',
          'aapl',
          'bid',
          100,
          10,
          10,
          'accepted',
          '2026-01-01T15:00:00Z',
          '2026-01-01T14:00:00Z',
          '2026-01-01T14:00:00Z'
        )
      `)
    ).rejects.toThrow();

    await expect(
      client.query(`
        INSERT INTO orders (
          order_id,
          broker_id,
          owner_document,
          symbol,
          side,
          price,
          original_quantity,
          remaining_quantity,
          status,
          valid_until,
          accepted_at,
          updated_at
        ) VALUES (
          'ord-2',
          'broker-1',
          '12345678900',
          'AAPL',
          'bid',
          100,
          10,
          11,
          'accepted',
          '2026-01-01T15:00:00Z',
          '2026-01-01T14:00:00Z',
          '2026-01-01T14:00:00Z'
        )
      `)
    ).rejects.toThrow();
  });

  it("requires a resting sequence for open and partially filled orders", async () => {
    await applyMigrations(client, migrationsDirectory);

    await expect(
      client.query(`
        INSERT INTO orders (
          order_id,
          broker_id,
          owner_document,
          symbol,
          side,
          price,
          original_quantity,
          remaining_quantity,
          status,
          valid_until,
          accepted_at,
          updated_at
        ) VALUES (
          'ord-open',
          'broker-1',
          '12345678900',
          'AAPL',
          'bid',
          100,
          10,
          10,
          'open',
          '2026-01-01T15:00:00Z',
          '2026-01-01T14:00:00Z',
          '2026-01-01T14:00:01Z'
        )
      `)
    ).rejects.toThrow();
  });

  it("enforces idempotency and processed command uniqueness", async () => {
    await applyMigrations(client, migrationsDirectory);

    await client.query(`
      INSERT INTO orders (
        order_id,
        broker_id,
        owner_document,
        symbol,
        side,
        price,
        original_quantity,
        remaining_quantity,
        status,
        valid_until,
        accepted_at,
        updated_at
      ) VALUES (
        'ord-1',
        'broker-1',
        '12345678900',
        'AAPL',
        'bid',
        100,
        10,
        10,
        'accepted',
        '2026-01-01T15:00:00Z',
        '2026-01-01T14:00:00Z',
        '2026-01-01T14:00:00Z'
      )
    `);

    await client.query(`
      INSERT INTO idempotency_keys (
        broker_id,
        idempotency_key,
        order_id,
        request_hash,
        created_at
      ) VALUES (
        'broker-1',
        'idem-1',
        'ord-1',
        'hash-1',
        '2026-01-01T14:00:00Z'
      )
    `);

    await expect(
      client.query(`
        INSERT INTO idempotency_keys (
          broker_id,
          idempotency_key,
          order_id,
          request_hash,
          created_at
        ) VALUES (
          'broker-1',
          'idem-1',
          'ord-1',
          'hash-1',
          '2026-01-01T14:00:01Z'
        )
      `)
    ).rejects.toThrow();

    await client.query(`
      INSERT INTO processed_commands (
        command_id,
        command_type,
        symbol,
        order_id,
        processed_at
      ) VALUES (
        'cmd-1',
        'SubmitOrder',
        'AAPL',
        'ord-1',
        '2026-01-01T14:00:01Z'
      )
    `);

    await expect(
      client.query(`
        INSERT INTO processed_commands (
          command_id,
          command_type,
          symbol,
          order_id,
          processed_at
        ) VALUES (
          'cmd-1',
          'SubmitOrder',
          'AAPL',
          'ord-1',
          '2026-01-01T14:00:02Z'
        )
      `)
    ).rejects.toThrow();
  });
});
