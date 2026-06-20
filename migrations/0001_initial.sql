CREATE TABLE users (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  dedupe_enabled INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_categories_kind_active
  ON categories (kind, is_active, sort_order);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tags_active_name
  ON tags (is_active, name);

CREATE TABLE entry_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  display_name TEXT,
  source_file_name TEXT,
  source_sha256 TEXT,
  idempotency_key TEXT,
  raw_input_summary TEXT,
  raw_text TEXT,
  raw_payload_json TEXT,
  status TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_entry_sources_idempotency_key
  ON entry_sources (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_entry_sources_status_created
  ON entry_sources (status, created_at);

CREATE TABLE entry_source_items (
  id TEXT PRIMARY KEY,
  entry_source_id TEXT NOT NULL,
  item_index INTEGER NOT NULL DEFAULT 0,
  entry_type TEXT NOT NULL,
  subject_user_id TEXT,
  entry_date TEXT,
  amount INTEGER,
  currency TEXT NOT NULL DEFAULT 'JPY',
  target TEXT,
  category_id_guess TEXT,
  category_name_guess TEXT,
  tags_json TEXT,
  memo TEXT,
  confidence REAL,
  dedupe_key TEXT,
  status TEXT NOT NULL,
  posted_entry_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_entry_source_items_source
  ON entry_source_items (entry_source_id, item_index);

CREATE INDEX idx_entry_source_items_status
  ON entry_source_items (status);

CREATE INDEX idx_entry_source_items_date_amount
  ON entry_source_items (entry_date, amount);

CREATE INDEX idx_entry_source_items_dedupe
  ON entry_source_items (dedupe_key, status);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL,
  subject_user_id TEXT,
  entry_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  category_id TEXT,
  target TEXT,
  memo TEXT,
  entry_source_id TEXT,
  entry_source_item_id TEXT,
  dedupe_key TEXT,
  fixed_at TEXT,
  archived_at TEXT,
  archive_year_id TEXT
);

CREATE INDEX idx_entries_date
  ON entries (entry_date);

CREATE INDEX idx_entries_type_date
  ON entries (entry_type, entry_date);

CREATE INDEX idx_entries_category_date
  ON entries (category_id, entry_date);

CREATE INDEX idx_entries_subject_date
  ON entries (subject_user_id, entry_date);

CREATE INDEX idx_entries_source
  ON entries (entry_source_id, entry_source_item_id);

CREATE INDEX idx_entries_dedupe
  ON entries (dedupe_key);

CREATE TABLE expense_entries (
  entry_id TEXT PRIMARY KEY
);

CREATE TABLE income_entries (
  entry_id TEXT PRIMARY KEY
);

CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE INDEX idx_entry_tags_tag
  ON entry_tags (tag_id, entry_id);

CREATE TABLE financial_assets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  quantity_text TEXT,
  valuation_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'JPY',
  valuation_updated_at TEXT,
  valuation_note TEXT,
  updated_by TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_financial_assets_owner
  ON financial_assets (owner_user_id, is_active);

CREATE TABLE duplicate_exclusions (
  id TEXT PRIMARY KEY,
  entry_source_item_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  pair_key TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_duplicate_exclusions_item
  ON duplicate_exclusions (entry_source_item_id);

CREATE INDEX idx_duplicate_exclusions_entry
  ON duplicate_exclusions (entry_id);
