import { describe, expect, it } from "vitest";

import { PostgresAdvisoryLockManager } from "./postgres-advisory-lock-manager";

describe("PostgresAdvisoryLockManager", () => {
  it("returns a lease and releases the underlying client", async () => {
    const queries: Array<{ text: string; params?: readonly unknown[] }> = [];
    let released = false;

    const manager = new PostgresAdvisoryLockManager({
      connect: async () => ({
        query: async (text, params) => {
          queries.push({ text, params });

          if (text.includes("pg_try_advisory_lock")) {
            return { rows: [{ acquired: true }] };
          }

          return { rows: [] };
        },
        release: () => {
          released = true;
        }
      }),
      query: async () => ({ rows: [] })
    });

    const lease = await manager.tryAcquire("expiration-scheduler");

    expect(lease).not.toBeNull();

    await lease?.release();

    expect(queries[0]?.text).toContain("pg_try_advisory_lock");
    expect(queries[1]?.text).toContain("pg_advisory_unlock");
    expect(released).toBe(true);
  });

  it("returns null when the advisory lock cannot be acquired", async () => {
    let released = false;

    const manager = new PostgresAdvisoryLockManager({
      connect: async () => ({
        query: async () => ({ rows: [{ acquired: false }] }),
        release: () => {
          released = true;
        }
      }),
      query: async () => ({ rows: [] })
    });

    const lease = await manager.tryAcquire("expiration-scheduler");

    expect(lease).toBeNull();
    expect(released).toBe(true);
  });
});

