CREATE TABLE IF NOT EXISTS access_code_redemptions (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  granted_at TEXT,
  FOREIGN KEY (code) REFERENCES access_codes(code) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_code_redemptions_user_id
  ON access_code_redemptions(user_id);

CREATE TABLE IF NOT EXISTS usage_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  slot_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, period_start, slot_number)
);

CREATE INDEX IF NOT EXISTS idx_usage_reservations_user_period
  ON usage_reservations(user_id, period_start);

CREATE INDEX IF NOT EXISTS idx_usage_reservations_status_created
  ON usage_reservations(status, created_at);
