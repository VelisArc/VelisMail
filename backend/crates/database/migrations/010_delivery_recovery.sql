-- Migration 010: faster stale-delivery recovery and dead-letter reporting.
--
-- Workers claim rows with `FOR UPDATE SKIP LOCKED`. If a worker dies while a
-- row is in `processing`, the index below makes the periodic recovery sweep
-- cheap; the second index keeps the dead-letter dashboard query fast.

CREATE INDEX IF NOT EXISTS idx_delivery_queue_stale
    ON delivery_queue(updated_at)
    WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_delivery_queue_dead_letter
    ON delivery_queue(updated_at DESC)
    WHERE status = 'dead_letter';
