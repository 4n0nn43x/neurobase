/**
 * Result Verifier
 * Validates SQL results before returning to users
 * Uses sandbox execution (BEGIN/ROLLBACK) for safety
 */

import { DatabaseAdapter } from '../database/adapter';
import { SQLSecurityAnalyzer } from '../security/sql-parser';
export interface VerificationResult {
  valid: boolean;
  step: string;
  issues: string[];
  correctedSQL?: string;
  rowCount?: number;
  executionTimeMs?: number;
}

export class ResultVerifier {
  private adapter: DatabaseAdapter;
  private securityAnalyzer: SQLSecurityAnalyzer;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
    this.securityAnalyzer = new SQLSecurityAnalyzer();
  }

  /**
   * Full 5-step verification pipeline
   */
  async verify(
    sql: string,
    schema: { tables: Array<{ name: string; columns: Array<{ name: string }> }> }
  ): Promise<VerificationResult> {
    const issues: string[] = [];

    // Step 1: SQL syntax validation via AST parse
    const securityResult = this.securityAnalyzer.analyze(sql, this.adapter.getDialectName());
    if (!securityResult.isAllowed) {
      return {
        valid: false,
        step: 'security-check',
        issues: securityResult.issues.map(i => `[${i.severity}] ${i.message}`),
      };
    }

    // Step 2: Check table/column references exist in schema
    const refIssues = this.checkSchemaReferences(sql, schema);
    if (refIssues.length > 0) {
      issues.push(...refIssues);
    }

    // Step 3: Sandbox execution (BEGIN, execute, ROLLBACK)
    const sandboxResult = await this.sandboxExecute(sql);

    if (!sandboxResult.success) {
      return {
        valid: false,
        step: 'sandbox-execution',
        issues: [...issues, sandboxResult.error || 'Sandbox execution failed'],
      };
    }

    // Step 4: Result shape validation
    if (sandboxResult.rowCount !== undefined) {
      if (sandboxResult.rowCount > 10000) {
        issues.push(`Large result set: ${sandboxResult.rowCount} rows. Consider adding LIMIT.`);
      }
    }

    // Step 5: All checks passed
    return {
      valid: issues.length === 0 || !issues.some(i => i.startsWith('[critical]') || i.startsWith('[high]')),
      step: 'complete',
      issues,
      rowCount: sandboxResult.rowCount,
      executionTimeMs: sandboxResult.executionTimeMs,
    };
  }

  /**
   * Quick verify (steps 1-2 only, no execution)
   */
  quickVerify(
    sql: string,
    schema: { tables: Array<{ name: string; columns: Array<{ name: string }> }> }
  ): VerificationResult {
    const securityResult = this.securityAnalyzer.analyze(sql, this.adapter.getDialectName());
    if (!securityResult.isAllowed) {
      return {
        valid: false,
        step: 'security-check',
        issues: securityResult.issues.map(i => `[${i.severity}] ${i.message}`),
      };
    }

    const refIssues = this.checkSchemaReferences(sql, schema);
    return {
      valid: refIssues.length === 0,
      step: 'schema-check',
      issues: refIssues,
    };
  }

  private checkSchemaReferences(
    sql: string,
    schema: { tables: Array<{ name: string; columns: Array<{ name: string }> }> }
  ): string[] {
    const issues: string[] = [];
    const tableNames = new Set(schema.tables.map(t => t.name.toLowerCase()));

    // Extract table references from SQL (simplified)
    const fromMatch = sql.match(/FROM\s+(\w+)/gi);
    const joinMatch = sql.match(/JOIN\s+(\w+)/gi);
    const intoMatch = sql.match(/INTO\s+(\w+)/gi);
    const updateMatch = sql.match(/UPDATE\s+(\w+)/gi);

    const referencedTables = new Set<string>();
    for (const matches of [fromMatch, joinMatch, intoMatch, updateMatch]) {
      if (matches) {
        for (const m of matches) {
          const tableName = m.split(/\s+/)[1]?.toLowerCase();
          if (tableName && !['select', 'where', 'on', 'set'].includes(tableName)) {
            referencedTables.add(tableName);
          }
        }
      }
    }

    // Check system tables are valid
    const systemTables = new Set(['pg_tables', 'pg_stat_activity', 'information_schema', 'pg_class', 'pg_index']);
    for (const table of referencedTables) {
      if (!tableNames.has(table) && !systemTables.has(table) && !table.startsWith('pg_') && !table.startsWith('neurobase_')) {
        issues.push(`Table "${table}" not found in schema`);
      }
    }

    return issues;
  }

  private async sandboxExecute(sql: string): Promise<{
    success: boolean;
    rowCount?: number;
    executionTimeMs?: number;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      const tx = await this.adapter.beginTransaction();

      try {
        const result = await tx.query(sql);
        const executionTimeMs = Date.now() - startTime;

        // Always rollback - this is a sandbox
        await tx.rollback();

        return {
          success: true,
          rowCount: result.rowCount,
          executionTimeMs,
        };
      } catch (error: any) {
        await tx.rollback();
        return {
          success: false,
          error: error.message,
          executionTimeMs: Date.now() - startTime,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Transaction failed: ${error.message}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
