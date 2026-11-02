CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  records TEXT NOT NULL
);
