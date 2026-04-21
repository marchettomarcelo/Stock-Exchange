import { TOP_SP500_MOST_ACTIVE_SYMBOLS } from "../fixtures/top-sp500-most-active-symbols";
import { murmur2, toPositiveHash } from "./murmur2";

export interface CommandsTopicPartitionAssignment {
  partition: number;
  symbols: string[];
}

export function partitionForKafkaKey(key: string, partitions: number): number {
  if (partitions <= 0) {
    throw new Error("Partition count must be greater than zero.");
  }

  return toPositiveHash(murmur2(key)) % partitions;
}

export function groupSymbolsByPartition(
  symbols: readonly string[],
  partitions: number
): CommandsTopicPartitionAssignment[] {
  const assignments = new Map<number, string[]>();

  for (let partition = 0; partition < partitions; partition += 1) {
    assignments.set(partition, []);
  }

  for (const symbol of symbols) {
    assignments.get(partitionForKafkaKey(symbol, partitions))?.push(symbol);
  }

  return [...assignments.entries()].map(([partition, assignedSymbols]) => ({
    partition,
    symbols: assignedSymbols
  }));
}

export function getDefaultCommandsTopicAssignments(
  partitions = 2
): CommandsTopicPartitionAssignment[] {
  return groupSymbolsByPartition(TOP_SP500_MOST_ACTIVE_SYMBOLS, partitions);
}
