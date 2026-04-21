import { createHash } from "node:crypto";

import type { RequestHasher } from "@decade/application";

export class JsonRequestHasher implements RequestHasher {
  hash(value: unknown): string {
    return createHash("sha256").update(toCanonicalJson(value)).digest("hex");
  }
}

function toCanonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));

    return Object.fromEntries(entries.map(([key, entryValue]) => [key, normalize(entryValue)]));
  }

  return value;
}
