/**
 * Immutable Audit Logger
 * Records all database operations in an append-only audit trail
 */

import { DatabaseAdapter } from '../database/adapter';
import { logger } from '../utils/logger';

export type AuditAction = 'query' | 'insert' | 'update' | 'delete' | 'schema_change' | 'auth' | 'fork' | 'admin';
export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditEntry {
  traceId?: string;
  agentId?: string;
  userId?: string;
  action: AuditAction;
  sqlHash?: string;
  sql?: string;
  resultRows?: number;
  executionTimeMs?: number;
  severity: AuditSeverity;
  metadata?: Record<string, any>;
}

export class AuditLogger {
  private adapter: DatabaseAdapter;
  private initialized = false;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
  }

  /**
   * Initialize audit tables
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.adapter.query(`
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
      `);

      // Revoke UPDATE and DELETE on audit table to ensure immutability
      try {
        await this.adapter.query(`
          REVOKE UPDATE, DELETE ON neurobase_audit_log FROM PUBLIC;
        `);
      } catch {
        // May fail if role doesn't have grant privileges, that's ok
      }

      this.initialized = true;
      logger.debug('Audit logging initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize audit logging');
    }
  }

  /**
   * Log an audit entry (INSERT only)
   */
  async log(entry: AuditEntry): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const sqlPreview = entry.sql ? entry.sql.substring(0, 200) : null;

      await this.adapter.query(
        `INSERT INTO neurobase_audit_log
          (trace_id, agent_id, user_id, action, sql_hash, sql_preview, result_rows, execution_time_ms, severity, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          entry.traceId || null,
          entry.agentId || null,
          entry.userId || null,
          entry.action,
          entry.sqlHash || null,
          sqlPreview,
          entry.resultRows ?? null,
          entry.executionTimeMs ?? null,
          entry.severity,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        ]
      );
    } catch (error) {
      // Don't let audit failures break the main flow
      logger.error({ error }, 'Failed to write audit log entry');
    }
  }

  /**
   * Query audit log (read-only)
   */
  async query(options: {
    userId?: string;
    action?: AuditAction;
    severity?: AuditSeverity;
    since?: Date;
    limit?: number;
  }): Promise<any[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (options.userId) {
      conditions.push(`user_id = $${paramIdx++}`);
      params.push(options.userId);
    }
    if (options.action) {
      conditions.push(`action = $${paramIdx++}`);
      params.push(options.action);
    }
    if (options.severity) {
      conditions.push(`severity = $${paramIdx++}`);
      params.push(options.severity);
    }
    if (options.since) {
      conditions.push(`timestamp >= $${paramIdx++}`);
      params.push(options.since);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 100;

    const result = await this.adapter.query(
      `SELECT * FROM neurobase_audit_log ${whereClause} ORDER BY timestamp DESC LIMIT $${paramIdx}`,
      [...params, limit]
    );

    return result.rows;
  }

  /**
   * Export audit logs as JSON for compliance
   */
  async exportJSON(since: Date, until?: Date): Promise<string> {
    const conditions = ['timestamp >= $1'];
    const params: any[] = [since];

    if (until) {
      conditions.push('timestamp <= $2');
      params.push(until);
    }

    const result = await this.adapter.query(
      `SELECT * FROM neurobase_audit_log WHERE ${conditions.join(' AND ')} ORDER BY timestamp ASC`,
      params
    );

    return JSON.stringify(result.rows, null, 2);
  }
}
