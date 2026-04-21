import {
  TOP_SP500_MOST_ACTIVE_SYMBOLS,
  getDefaultCommandsTopicAssignments
} from "../index";

const partitions = Number.parseInt(process.env.KAFKA_COMMANDS_PARTITIONS ?? "2", 10);
const assignments = getDefaultCommandsTopicAssignments(partitions);

console.log(`Commands topic sharding for ${partitions} partition(s)`);
console.log(`Symbols: ${TOP_SP500_MOST_ACTIVE_SYMBOLS.join(", ")}`);

for (const assignment of assignments) {
  console.log(`Partition ${assignment.partition}: ${assignment.symbols.join(", ") || "(empty)"}`);
}
