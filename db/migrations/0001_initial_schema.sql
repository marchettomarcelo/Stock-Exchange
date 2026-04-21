CREATE SEQUENCE order_resting_sequence_seq AS BIGINT;

CREATE TABLE orders (
  order_id TEXT PRIMARY KEY,
  broker_id TEXT NOT NULL,
  owner_document TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('bid', 'ask')),
  price INTEGER NOT NULL CHECK (price > 0),
  original_quantity INTEGER NOT NULL CHECK (original_quantity > 0),
  remaining_quantity INTEGER NOT NULL CHECK (
    remaining_quantity >= 0 AND remaining_quantity <= original_quantity
  ),
  status TEXT NOT NULL CHECK (
    status IN ('accepted', 'open', 'partially_filled', 'filled', 'expired')
  ),
  valid_until TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  resting_sequence BIGINT UNIQUE,
  CHECK (char_length(symbol) BETWEEN 1 AND 16),
  CHECK (substring(symbol FROM 1 FOR 1) BETWEEN 'A' AND 'Z'),
  CHECK (translate(symbol, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-', '') = ''),
  CHECK (accepted_at <= updated_at),
  CHECK (status <> 'filled' OR remaining_quantity = 0),
  CHECK (status <> 'accepted' OR remaining_quantity = original_quantity),
  CHECK (
    status NOT IN ('open', 'partially_filled')
    OR resting_sequence IS NOT NULL
  )
);

CREATE TABLE trades (
  trade_id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  buy_order_id TEXT NOT NULL REFERENCES orders(order_id),
  sell_order_id TEXT NOT NULL REFERENCES orders(order_id),
  price INTEGER NOT NULL CHECK (price > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  executed_at TIMESTAMPTZ NOT NULL,
  CHECK (char_length(symbol) BETWEEN 1 AND 16),
  CHECK (substring(symbol FROM 1 FOR 1) BETWEEN 'A' AND 'Z'),
  CHECK (translate(symbol, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-', '') = ''),
  CHECK (buy_order_id <> sell_order_id)
);

CREATE TABLE order_events (
  event_id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(order_id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE idempotency_keys (
  broker_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(order_id),
  request_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (broker_id, idempotency_key)
);

CREATE TABLE processed_commands (
  command_id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  order_id TEXT,
  processed_at TIMESTAMPTZ NOT NULL,
  CHECK (char_length(symbol) BETWEEN 1 AND 16),
  CHECK (substring(symbol FROM 1 FOR 1) BETWEEN 'A' AND 'Z'),
  CHECK (translate(symbol, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-', '') = '')
);

CREATE INDEX idx_orders_symbol_status_valid_until
  ON orders (symbol, status, valid_until);

CREATE INDEX idx_orders_live_recovery
  ON orders (symbol, resting_sequence)
  WHERE status IN ('open', 'partially_filled');

CREATE INDEX idx_orders_live_expiration
  ON orders (valid_until)
  WHERE status IN ('accepted', 'open', 'partially_filled');

CREATE INDEX idx_trades_buy_order_id
  ON trades (buy_order_id);

CREATE INDEX idx_trades_sell_order_id
  ON trades (sell_order_id);

CREATE INDEX idx_order_events_order_id_created_at
  ON order_events (order_id, created_at);

CREATE INDEX idx_processed_commands_symbol_processed_at
  ON processed_commands (symbol, processed_at);
