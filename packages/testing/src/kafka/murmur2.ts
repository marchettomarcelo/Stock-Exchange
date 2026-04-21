const DEFAULT_SEED = 0x9747b28c;
const MIXING_CONSTANT = 0x5bd1e995;
const RIGHT_SHIFT = 24;

export function murmur2(input: string | Uint8Array): number {
  const data = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  const length = data.length;
  let hash = DEFAULT_SEED ^ length;
  const length4 = length >> 2;

  for (let index = 0; index < length4; index += 1) {
    const offset = index << 2;
    let key =
      (data[offset] & 0xff) |
      ((data[offset + 1] & 0xff) << 8) |
      ((data[offset + 2] & 0xff) << 16) |
      ((data[offset + 3] & 0xff) << 24);

    key = Math.imul(key, MIXING_CONSTANT);
    key ^= key >>> RIGHT_SHIFT;
    key = Math.imul(key, MIXING_CONSTANT);

    hash = Math.imul(hash, MIXING_CONSTANT);
    hash ^= key;
  }

  switch (length & 3) {
    case 3:
      hash ^= (data[(length & ~3) + 2] & 0xff) << 16;
      // falls through
    case 2:
      hash ^= (data[(length & ~3) + 1] & 0xff) << 8;
      // falls through
    case 1:
      hash ^= data[length & ~3] & 0xff;
      hash = Math.imul(hash, MIXING_CONSTANT);
      break;
    default:
      break;
  }

  hash ^= hash >>> 13;
  hash = Math.imul(hash, MIXING_CONSTANT);
  hash ^= hash >>> 15;

  return hash;
}

export function toPositiveHash(hash: number): number {
  return hash & 0x7fffffff;
}
