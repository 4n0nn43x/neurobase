/**
 * SQL Security Analyzer
 * Uses AST parsing to detect dangerous SQL patterns
 */

import { Parser } from 'node-sql-parser';
import { logger } from '../utils/logger';

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecurityIssue {
  severity: SecuritySeverity;
  message: string;
  category: string;
}

export interface SecurityAnalysis {
  isAllowed: boolean;
  issues: SecurityIssue[];
  statementType: string | null;
  tablesAccessed: string[];
}

export class SQLSecurityAnalyzer {
  private parser: Parser;
  /** Statements that are allowed for normal operations */
  allowedStatements = new Set(['select', 'insert', 'update', 'delete', 'with']);
  private blockedStatements = new Set([
    'drop', 'truncate', 'alter', 'create', 'grant', 'revoke',
    'rename', 'comment', 'set', 'reset', 'copy',
  ]);

  constructor() {
    this.parser = new Parser();
  }

  /**
   * Analyze SQL for security issues
   */
  analyze(sql: string, dialect: string = 'PostgreSQL'): SecurityAnalysis {
    const issues: SecurityIssue[] = [];
    const tablesAccessed: string[] = [];
    let statementType: string | null = null;

    // Check for multi-statement injection (semicolons)
    const statements = sql.split(';').filter(s => s.trim().length > 0);
    if (statements.length > 1) {
      issues.push({
        severity: 'critical',
        message: 'Multiple statements detected - potential SQL injection',
        category: 'injection',
      });
    }

    try {
      const ast = this.parser.astify(sql, { database: this.mapDialect(dialect) });
      const astArray = Array.isArray(ast) ? ast : [ast];

      for (const node of astArray) {
        if (!node) continue;

        statementType = (node as any).type?.toLowerCase() || null;

        // Check statement type
        if (statementType && this.blockedStatements.has(statementType)) {
          issues.push({
            severity: 'critical',
            message: `Blocked statement type: ${statementType.toUpperCase()}`,
            category: 'ddl',
          });
        }

        // Extract tables
        this.extractTables(node, tablesAccessed);

        // Check for specific dangerous patterns
        this.checkDangerousPatterns(node, statementType, issues);
      }
    } catch (parseError) {
      // If parsing fails, fall back to regex checks
      logger.debug({ parseError }, 'AST parsing failed, falling back to regex analysis');
      this.regexFallback(sql, issues);
      statementType = this.detectStatementType(sql);
    }

    const isAllowed = !issues.some(i => i.severity === 'critical' || i.severity === 'high');

    return {
      isAllowed,
      issues,
      statementType,
      tablesAccessed: [...new Set(tablesAccessed)],
    };
  }

  private mapDialect(dialect: string): string {
    const map: Record<string, string> = {
      'PostgreSQL': 'PostgreSQL',
      'MySQL': 'MySQL',
      'SQLite': 'SQLite',
    };
    return map[dialect] || 'PostgreSQL';
  }

  private extractTables(node: any, tables: string[]): void {
    if (!node || typeof node !== 'object') return;

    if (node.table) {
      tables.push(node.table);
    }

    if (node.from) {
      const fromList = Array.isArray(node.from) ? node.from : [node.from];
      for (const item of fromList) {
        if (item?.table) tables.push(item.table);
        if (item?.expr) this.extractTables(item.expr, tables);
      }
    }

    // Recursively check subqueries
    for (const key of Object.keys(node)) {
      if (key === 'from') continue; // Already handled
      const val = node[key];
      if (val && typeof val === 'object') {
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === 'object') this.extractTables(item, tables);
          }
        } else {
          this.extractTables(val, tables);
        }
      }
    }
  }

  private checkDangerousPatterns(node: any, stmtType: string | null, issues: SecurityIssue[]): void {
    // DELETE without WHERE
    if (stmtType === 'delete' && !node.where) {
      issues.push({
        severity: 'critical',
        message: 'DELETE without WHERE clause - would delete ALL rows',
        category: 'destructive',
      });
    }

    // UPDATE without WHERE
    if (stmtType === 'update' && !node.where) {
      issues.push({
        severity: 'high',
        message: 'UPDATE without WHERE clause - would update ALL rows',
        category: 'destructive',
      });
    }

    // GRANT/REVOKE
    if (stmtType === 'grant' || stmtType === 'revoke') {
      issues.push({
        severity: 'critical',
        message: `${stmtType?.toUpperCase()} statement detected - privilege escalation attempt`,
        category: 'privilege',
      });
    }

    // Check for information_schema or pg_catalog access (potential reconnaissance)
    const sql = typeof node === 'string' ? node : JSON.stringify(node);
    if (/pg_shadow|pg_authid|pg_roles/i.test(sql)) {
      issues.push({
        severity: 'high',
        message: 'Access to sensitive system catalogs detected',
        category: 'reconnaissance',
      });
    }
  }

  private regexFallback(sql: string, issues: SecurityIssue[]): void {
    // DDL detection
    if (/^\s*(DROP|TRUNCATE|ALTER|CREATE)\s/i.test(sql)) {
      issues.push({
        severity: 'critical',
        message: 'DDL statement detected',
        category: 'ddl',
      });
    }

    // GRANT/REVOKE
    if (/^\s*(GRANT|REVOKE)\s/i.test(sql)) {
      issues.push({
        severity: 'critical',
        message: 'Privilege modification detected',
        category: 'privilege',
      });
    }

    // DELETE without WHERE
    if (/DELETE\s+FROM\s+\w+\s*$/i.test(sql.trim())) {
      issues.push({
        severity: 'critical',
        message: 'DELETE without WHERE clause',
        category: 'destructive',
      });
    }

    // Multi-statement (already checked above, but double-check)
    if (sql.includes(';') && sql.indexOf(';') < sql.length - 1) {
      const afterSemicolon = sql.substring(sql.indexOf(';') + 1).trim();
      if (afterSemicolon.length > 0) {
        issues.push({
          severity: 'critical',
          message: 'Multiple statements detected after semicolon',
          category: 'injection',
        });
      }
    }

    // Comment-based injection
    if (/--.*\b(DROP|DELETE|INSERT|UPDATE|ALTER|GRANT)\b/i.test(sql)) {
      issues.push({
        severity: 'high',
        message: 'Suspicious SQL comment containing dangerous keywords',
        category: 'injection',
      });
    }
  }

  private detectStatementType(sql: string): string | null {
    const match = sql.trim().match(/^(\w+)\s/i);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Quick check: is this SQL safe to execute?
   */
  isSafe(sql: string, dialect: string = 'PostgreSQL'): boolean {
    return this.analyze(sql, dialect).isAllowed;
  }
}
