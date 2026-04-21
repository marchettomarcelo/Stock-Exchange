import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "@decade/application";
import type { AppConfig } from "@decade/infrastructure";

import { ExpirationScheduler } from "../src/expiration/expiration-scheduler";

function createConfig(): AppConfig {
  return {
    serviceName: "matching-engine",
    logLevel: "info",
    database: {
      connectionString: "postgres://test",
      maxConnections: 10
    },
    kafka: {
      brokers: ["localhost:9092"],
      clientId: "decade",
      consumerGroupId: "matching-engine-workers",
      ssl: false,
      commandsTopic: "exchange.commands",
      commandsPartitions: 2
    },
    expiration: {
      scanIntervalMs: 50,
      scanLimit: 100,
      leaseName: "expiration-scheduler"
    }
  };
}

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("ExpirationScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately and then continues on the configured interval", async () => {
    const scanForExpiredOrders = {
      execute: vi.fn().mockResolvedValue({
        acquired: true,
        published: 2
      })
    };
    const scheduler = new ExpirationScheduler(
      scanForExpiredOrders as never,
      createConfig(),
      createLogger()
    );

    await scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(scanForExpiredOrders.execute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(49);
    expect(scanForExpiredOrders.execute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(scanForExpiredOrders.execute).toHaveBeenCalledTimes(2);
  });

  it("does not overlap scans when a cycle is still running", async () => {
    const firstRun = createDeferred<{ acquired: boolean; published: number }>();
    const scanForExpiredOrders = {
      execute: vi
        .fn()
        .mockReturnValueOnce(firstRun.promise)
        .mockResolvedValueOnce({
          acquired: false,
          published: 0
        })
    };
    const scheduler = new ExpirationScheduler(
      scanForExpiredOrders as never,
      createConfig(),
      createLogger()
    );

    await scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(200);

    expect(scanForExpiredOrders.execute).toHaveBeenCalledTimes(1);

    firstRun.resolve({
      acquired: true,
      published: 1
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);

    expect(scanForExpiredOrders.execute).toHaveBeenCalledTimes(2);
  });

  it("stops scheduling new scans after shutdown", async () => {
    const scanForExpiredOrders = {
      execute: vi.fn().mockResolvedValue({
        acquired: true,
        published: 1
      })
    };
    const scheduler = new ExpirationScheduler(
      scanForExpiredOrders as never,
      createConfig(),
      createLogger()
    );

    await scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    await scheduler.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(500);

    expect(scanForExpiredOrders.execute).toHaveBeenCalledTimes(1);
  });
});
