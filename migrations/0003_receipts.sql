CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  entry_source_id TEXT,
  display_name TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_receipts_entry_source
  ON receipts (entry_source_id)
  WHERE entry_source_id IS NOT NULL;

ALTER TABLE entries ADD COLUMN receipt_id TEXT;

CREATE INDEX idx_entries_receipt
  ON entries (receipt_id, entry_date);

INSERT INTO receipts (
  id,
  entry_source_id,
  display_name,
  created_by,
  created_at,
  updated_by,
  updated_at
)
SELECT
  'rct_legacy_' || s.id,
  s.id,
  s.display_name,
  s.created_by,
  s.created_at,
  s.updated_by,
  s.updated_at
FROM entry_sources s
WHERE s.source_type = 'receipt'
  AND EXISTS (
    SELECT 1
    FROM entries e
    WHERE e.entry_source_id = s.id
      AND e.entry_type = 'expense'
      AND e.archived_at IS NULL
  );

UPDATE entries
SET receipt_id = 'rct_legacy_' || entry_source_id
WHERE entry_type = 'expense'
  AND archived_at IS NULL
  AND entry_source_id IN (
    SELECT id
    FROM entry_sources
    WHERE source_type = 'receipt'
  );
