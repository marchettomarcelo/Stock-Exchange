import { describe, expect, it } from "vitest";

import { PostgresTransactionManager } from "./postgres-transaction-manager";

describe("PostgresTransactionManager", () => {
  it("commits when the work completes successfully", async () => {
    const statements: string[] = [];
    let released = false;

    const manager = new PostgresTransactionManager({
      connect: async () => ({
        query: async (text) => {
          statements.push(text);
          return { rows: [] };
        },
        release: () => {
          released = true;
        }
      }),
      query: async () => ({ rows: [] })
    });

    await manager.withTransaction(async () => "ok");

    expect(statements).toEqual(["BEGIN", "COMMIT"]);
    expect(released).toBe(true);
  });

  it("rolls back when the work throws", async () => {
    const statements: string[] = [];
    let released = false;

    const manager = new PostgresTransactionManager({
      connect: async () => ({
        query: async (text) => {
          statements.push(text);
          return { rows: [] };
        },
        release: () => {
          released = true;
        }
      }),
      query: async () => ({ rows: [] })
    });

    await expect(
      manager.withTransaction(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(statements).toEqual(["BEGIN", "ROLLBACK"]);
    expect(released).toBe(true);
  });
});

