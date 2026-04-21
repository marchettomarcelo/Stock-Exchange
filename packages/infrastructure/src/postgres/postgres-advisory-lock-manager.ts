import type { Lease, LeaseManager } from "@decade/application";

import type { PostgresPool, PostgresPoolClient, PostgresQueryRow } from "./postgres-types";

interface AdvisoryLockRow extends PostgresQueryRow {
  acquired: boolean;
}

function hashString(value: string, seed: number): number {
  let hash = seed;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x45d9f3b);
  }

  return hash | 0;
}

function hashAdvisoryLockName(name: string): [number, number] {
  return [hashString(name, 0x9e3779b1), hashString(name, 0x85ebca6b)];
}

class PostgresLease implements Lease {
  private released = false;

  constructor(
    public readonly name: string,
    private readonly client: PostgresPoolClient,
    private readonly keyA: number,
    private readonly keyB: number
  ) {}

  async release(): Promise<void> {
    if (this.released) {
      return;
    }

    this.released = true;

    try {
      await this.client.query("SELECT pg_advisory_unlock($1, $2)", [this.keyA, this.keyB]);
    } finally {
      this.client.release();
    }
  }
}

export class PostgresAdvisoryLockManager implements LeaseManager {
  constructor(private readonly pool: PostgresPool) {}

  async tryAcquire(name: string): Promise<Lease | null> {
    const client = await this.pool.connect();
    const [keyA, keyB] = hashAdvisoryLockName(name);

    try {
      const result = await client.query<AdvisoryLockRow>(
        "SELECT pg_try_advisory_lock($1, $2) AS acquired",
        [keyA, keyB]
      );

      if (!result.rows[0]?.acquired) {
        client.release();
        return null;
      }

      return new PostgresLease(name, client, keyA, keyB);
    } catch (error) {
      client.release();
      throw error;
    }
  }
}

