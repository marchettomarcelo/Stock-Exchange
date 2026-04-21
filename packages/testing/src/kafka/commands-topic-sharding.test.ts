import { describe, expect, it } from "vitest";

import { TOP_SP500_MOST_ACTIVE_SYMBOLS } from "../fixtures/top-sp500-most-active-symbols";
import {
  getDefaultCommandsTopicAssignments,
  groupSymbolsByPartition,
  partitionForKafkaKey
} from "./commands-topic-sharding";

describe("commands topic sharding", () => {
  it("pins the local top-10 most active S&P 500 symbols fixture", () => {
    expect(TOP_SP500_MOST_ACTIVE_SYMBOLS).toEqual([
      "NVDA",
      "NFLX",
      "INTC",
      "TSLA",
      "AMZN",
      "AAPL",
      "PLTR",
      "ORCL",
      "MSFT",
      "F"
    ]);
  });

  it("distributes the default fixture across two Kafka partitions", () => {
    expect(getDefaultCommandsTopicAssignments(2)).toEqual([
      {
        partition: 0,
        symbols: ["NFLX", "INTC", "MSFT", "F"]
      },
      {
        partition: 1,
        symbols: ["NVDA", "TSLA", "AMZN", "AAPL", "PLTR", "ORCL"]
      }
    ]);
  });

  it("keeps the partition selection stable for a given Kafka key", () => {
    expect(partitionForKafkaKey("AAPL", 2)).toBe(1);
    expect(partitionForKafkaKey("MSFT", 2)).toBe(0);
  });

  it("rejects invalid partition counts", () => {
    expect(() => groupSymbolsByPartition(["AAPL"], 0)).toThrow(
      "Partition count must be greater than zero."
    );
  });
});
