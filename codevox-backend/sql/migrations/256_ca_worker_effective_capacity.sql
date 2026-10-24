-- Effective capacity reported by shared-model workers when batch lagging.
ALTER TABLE ca_workers
  ADD COLUMN effective_capacity INT NULL AFTER max_streams_capacity;
