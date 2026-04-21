export const orderSideValues = ["bid", "ask"] as const;
export const orderStatusValues = [
  "accepted",
  "open",
  "partially_filled",
  "filled",
  "expired"
] as const;

export const symbolPattern = /^[A-Z][A-Z0-9.-]{0,15}$/;
export const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
