-- NeuroBase Audit Log Schema
-- Immutable, append-only audit trail for all database operations

CREATE TABLE IF NOT EXISTS neurobase_audit_log (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trace_id TEXT,
  agent_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  sql_hash TEXT,
  sql_preview TEXT,
  result_rows INTEGER,
  execution_time_ms INTEGER,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata JSONB
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_timestamp
  ON neurobase_audit_log(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user
  ON neurobase_audit_log(user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_action
  ON neurobase_audit_log(action, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_severity
  ON neurobase_audit_log(severity, timestamp DESC)
  WHERE severity != 'info';

-- Ensure immutability: revoke UPDATE and DELETE
REVOKE UPDATE, DELETE ON neurobase_audit_log FROM PUBLIC;
