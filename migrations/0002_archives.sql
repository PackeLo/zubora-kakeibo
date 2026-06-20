CREATE TABLE archive_years (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL,
  archive_format TEXT NOT NULL,
  archive_format_version INTEGER NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  expense_count INTEGER NOT NULL DEFAULT 0,
  income_count INTEGER NOT NULL DEFAULT 0,
  total_expense INTEGER NOT NULL DEFAULT 0,
  total_income INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'JPY',
  last_export_id TEXT,
  last_exported_at TEXT,
  last_exported_by TEXT,
  last_content_sha256 TEXT,
  external_backup_confirmed_at TEXT,
  external_backup_confirmed_by TEXT,
  external_storage_note TEXT,
  purged_at TEXT,
  purged_by TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_archive_years_status
  ON archive_years (status, year);

CREATE TABLE archive_exports (
  id TEXT PRIMARY KEY,
  archive_year_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  filename TEXT NOT NULL,
  archive_format TEXT NOT NULL,
  archive_format_version INTEGER NOT NULL,
  content_sha256 TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0,
  expense_count INTEGER NOT NULL DEFAULT 0,
  income_count INTEGER NOT NULL DEFAULT 0,
  total_expense INTEGER NOT NULL DEFAULT 0,
  total_income INTEGER NOT NULL DEFAULT 0,
  generated_by TEXT,
  generated_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  error_message TEXT
);

CREATE INDEX idx_archive_exports_year
  ON archive_exports (year, generated_at);

CREATE INDEX idx_archive_exports_archive_year
  ON archive_exports (archive_year_id, generated_at);
