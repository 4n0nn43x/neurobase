/**
 * Immutable Audit Logger — engine-portable.
 *
 * Records every database operation NeuroBase performs (queries, schema
 * changes, fork operations, admin actions). The intent is a tamper-evident
 * trail that survives across the four supported engines.
 *
 * Portability strategy:
 *   - DDL is rendered per engine via getDialectName(): PostgreSQL uses
 *     BIGSERIAL + TIMESTAMPTZ + JSONB; MySQL uses BIGINT AUTO_INCREMENT
 *     + DATETIME + JSON; SQLite uses INTEGER PRIMARY KEY AUTOINCREMENT
 *     + TEXT timestamps + TEXT metadata; MongoDB is skipped (it is not a
 *     SQL store and the orchestration agents that need an audit trail
 *     are PostgreSQL-only anyway).
 *   - Parameter style is taken from getDialectHints().parameterStyle so
 *     placeholders match the active driver ($1 for pg, ? for mysql/sqlite).
 *   - Immutability is enforced at the application layer: this class
 *     exposes `log()` (INSERT only) and `query()` / `exportJSON()` (SELECT
 *     only). The legacy `REVOKE UPDATE, DELETE` is best-effort and only
 *     issued on PostgreSQL where it works.
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

interface DialectDdl {
  /** SQL for the CREATE TABLE statement. */
  createTable: string;
  /** SQL for indexes (run separately so partial indexes can be skipped). */
  indexes: string[];
  /** Function returning the Nth placeholder for parameter binding. */
  placeholder: (n: number) => string;
  /** Optional immutability hardening (REVOKE on PG, no-op elsewhere). */
  hardenImmutability?: string;
}

export class AuditLogger {
  private adapter: DatabaseAdapter;
  private initialized = false;
  private engineName: string = 'PostgreSQL';
  private placeholder: (n: number) => string = (n) => `$${n}`;
  private supported = true;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.engineName = this.adapter.getDialectName?.() ?? 'PostgreSQL';

    if (this.engineName === 'MongoDB') {
      // MongoDB doesn't fit the SQL audit-table model. The single-agent
      // pipeline is fine without it; multi-agent (PG-only anyway) keeps
      // its own audit via the orchestrator tables.
      this.supported = false;
      this.initialized = true;
      logger.debug({ engine: this.engineName }, 'Audit log not supported on this engine — skipping');
      return;
    }

    const ddl = this.dialectDdl();
    this.placeholder = ddl.placeholder;

    try {
      await this.adapter.query(ddl.createTable);
      for (const indexSql of ddl.indexes) {
        try {
          await this.adapter.query(indexSql);
        } catch (err) {
          // Some engines reject "WHERE" partial indexes; that's OK, the
          // main index still exists. Log debug and continue.
          logger.debug({ err, indexSql }, 'Audit index creation skipped');
        }
      }
      if (ddl.hardenImmutability) {
        try {
          await this.adapter.query(ddl.hardenImmutability);
        } catch {
          // REVOKE requires grant privileges; best-effort only.
        }
      }
      this.initialized = true;
      logger.debug({ engine: this.engineName }, 'Audit logging initialized');
    } catch (error) {
      logger.error({ error, engine: this.engineName }, 'Failed to initialize audit logging');
      this.supported = false;
      this.initialized = true; // avoid retrying on every log() call
    }
  }

  /**
   * Log an audit entry (INSERT only — there is intentionally no update path).
   * Failures are swallowed so a broken audit log never blocks the main flow.
   */
  async log(entry: AuditEntry): Promise<void> {
    if (!this.initialized) await this.initialize();
    if (!this.supported) return;

    try {
      const sqlPreview = entry.sql ? entry.sql.substring(0, 200) : null;
      const p = this.placeholder;

      await this.adapter.query(
        `INSERT INTO neurobase_audit_log
          (trace_id, agent_id, user_id, action, sql_hash, sql_preview, result_rows, execution_time_ms, severity, metadata, timestamp)
         VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)})`,
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
          new Date().toISOString(),
        ],
      );
    } catch (error) {
      logger.error({ err: error }, 'Failed to write audit log entry');
    }
  }

  /**
   * Read audit log entries (SELECT only).
   */
  async query(options: {
    userId?: string;
    action?: AuditAction;
    severity?: AuditSeverity;
    since?: Date;
    limit?: number;
  }): Promise<any[]> {
    if (!this.supported) return [];

    const conditions: string[] = [];
    const params: any[] = [];
    const p = this.placeholder;

    if (options.userId)   { conditions.push(`user_id = ${p(params.length + 1)}`);   params.push(options.userId); }
    if (options.action)   { conditions.push(`action = ${p(params.length + 1)}`);    params.push(options.action); }
    if (options.severity) { conditions.push(`severity = ${p(params.length + 1)}`);  params.push(options.severity); }
    if (options.since)    { conditions.push(`timestamp >= ${p(params.length + 1)}`); params.push(options.since.toISOString()); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 100;
    params.push(limit);

    const result = await this.adapter.query(
      `SELECT * FROM neurobase_audit_log ${where} ORDER BY timestamp DESC LIMIT ${p(params.length)}`,
      params,
    );
    return result.rows;
  }

  /** Export entries as JSON for compliance evidence. */
  async exportJSON(since: Date, until?: Date): Promise<string> {
    if (!this.supported) return '[]';

    const p = this.placeholder;
    const conditions = [`timestamp >= ${p(1)}`];
    const params: any[] = [since.toISOString()];
    if (until) {
      conditions.push(`timestamp <= ${p(2)}`);
      params.push(until.toISOString());
    }
    const result = await this.adapter.query(
      `SELECT * FROM neurobase_audit_log WHERE ${conditions.join(' AND ')} ORDER BY timestamp ASC`,
      params,
    );
    return JSON.stringify(result.rows, null, 2);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Dialect-specific DDL
  // ────────────────────────────────────────────────────────────────────────

  private dialectDdl(): DialectDdl {
    const engine = this.engineName;
    if (engine === 'PostgreSQL') {
      return {
        createTable: `
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
          )
        `,
        indexes: [
          `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON neurobase_audit_log(timestamp DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_audit_user ON neurobase_audit_log(user_id, timestamp DESC) WHERE user_id IS NOT NULL`,
          `CREATE INDEX IF NOT EXISTS idx_audit_action ON neurobase_audit_log(action, timestamp DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_audit_severity ON neurobase_audit_log(severity, timestamp DESC) WHERE severity != 'info'`,
        ],
        placeholder: (n) => `$${n}`,
        hardenImmutability: `REVOKE UPDATE, DELETE ON neurobase_audit_log FROM PUBLIC`,
      };
    }

    if (engine === 'MySQL') {
      return {
        createTable: `
          CREATE TABLE IF NOT EXISTS neurobase_audit_log (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            trace_id VARCHAR(64),
            agent_id VARCHAR(64),
            user_id VARCHAR(128),
            action VARCHAR(32) NOT NULL,
            sql_hash VARCHAR(128),
            sql_preview TEXT,
            result_rows INT,
            execution_time_ms INT,
            severity VARCHAR(16) NOT NULL DEFAULT 'info',
            metadata JSON
          )
        `,
        indexes: [
          `CREATE INDEX idx_audit_timestamp ON neurobase_audit_log(timestamp)`,
          `CREATE INDEX idx_audit_user ON neurobase_audit_log(user_id, timestamp)`,
          `CREATE INDEX idx_audit_action ON neurobase_audit_log(action, timestamp)`,
        ],
        placeholder: () => '?',
      };
    }

    // SQLite — INTEGER autoincrement + TEXT timestamps + TEXT JSON
    return {
      createTable: `
        CREATE TABLE IF NOT EXISTS neurobase_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          trace_id TEXT,
          agent_id TEXT,
          user_id TEXT,
          action TEXT NOT NULL,
          sql_hash TEXT,
          sql_preview TEXT,
          result_rows INTEGER,
          execution_time_ms INTEGER,
          severity TEXT NOT NULL DEFAULT 'info',
          metadata TEXT
        )
      `,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON neurobase_audit_log(timestamp DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_user ON neurobase_audit_log(user_id, timestamp DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_action ON neurobase_audit_log(action, timestamp DESC)`,
      ],
      placeholder: () => '?',
    };
  }
}
