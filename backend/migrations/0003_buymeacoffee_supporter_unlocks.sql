ALTER TABLE users ADD COLUMN donation_unlocked_at TEXT;
ALTER TABLE users ADD COLUMN donation_source TEXT;
ALTER TABLE users ADD COLUMN donation_reference TEXT;

CREATE TABLE IF NOT EXISTS buymeacoffee_events (
  event_key TEXT PRIMARY KEY,
  source_event_id TEXT,
  event_type TEXT NOT NULL,
  event_status TEXT,
  email TEXT,
  amount TEXT,
  currency TEXT,
  matched_user_id TEXT,
  action TEXT NOT NULL,
  raw_body TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (matched_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_buymeacoffee_events_email
  ON buymeacoffee_events(email);

CREATE INDEX IF NOT EXISTS idx_buymeacoffee_events_source_event_id
  ON buymeacoffee_events(source_event_id);
