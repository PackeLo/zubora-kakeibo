CREATE UNIQUE INDEX idx_entries_unique_source_item
  ON entries (entry_source_item_id)
  WHERE entry_source_item_id IS NOT NULL;
