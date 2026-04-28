/**
 * SQL Security Analyzer — orchestrates the focused check modules in
 * src/security/sql/ (destructive, injection, privilege, ddl, system-catalog).
 *
 * The class API (`SQLSecurityAnalyzer.analyze`, `.isSafe`) is preserved for
 * call-site backwards compatibility; the actual rules now live in single-
 * purpose modules so they can be tested and tuned independently.
 */

import { Parser } from 'node-sql-parser';
import { logger } from '../utils/logger';
import { checkAstDestructive, checkRegexDestructive } from './sql/destructive';
import { checkMultiStatement, checkCommentInjection } from './sql/injection';
import { checkAstPrivilege, checkRegexPrivilege } from './sql/privilege';
import { checkAstDDL, checkRegexDDL } from './sql/ddl';
import { checkSystemCatalogAccess } from './sql/system-catalog';
import type { SecurityIssue, SecurityAnalysis } from './sql/types';

export type { SecurityIssue, SecurityAnalysis, SecuritySeverity, IssueCategory } from './sql/types';

export class SQLSecurityAnalyzer {
  private parser: Parser;
  /** Statements that are allowed for normal operations */
  allowedStatements = new Set(['select', 'insert', 'update', 'delete', 'with']);

  constructor() {
    this.parser = new Parser();
  }

  analyze(sql: string, dialect: string = 'PostgreSQL'): SecurityAnalysis {
    const issues: SecurityIssue[] = [];
    const tablesAccessed: string[] = [];
    let statementType: string | null = null;

    // Shape-level checks run first — they look at the raw text and catch
    // injection patterns the AST parser would silently accept.
    issues.push(...checkMultiStatement(sql));
    issues.push(...checkCommentInjection(sql));
    issues.push(...checkSystemCatalogAccess(sql));

    try {
      const ast = this.parser.astify(sql, { database: this.mapDialect(dialect) });
      const astArray = Array.isArray(ast) ? ast : [ast];

      for (const node of astArray) {
        if (!node) continue;
        statementType = (node as { type?: string }).type?.toLowerCase() || null;

        issues.push(...checkAstDDL(statementType));
        issues.push(...checkAstPrivilege(statementType));
        issues.push(...checkAstDestructive(node as { where?: unknown }, statementType));

        this.extractTables(node, tablesAccessed);
      }
    } catch (parseError) {
      logger.debug({ parseError }, 'AST parsing failed, falling back to regex analysis');
      issues.push(...checkRegexDDL(sql));
      issues.push(...checkRegexPrivilege(sql));
      issues.push(...checkRegexDestructive(sql));
      statementType = this.detectStatementType(sql);
    }

    const isAllowed = !issues.some((i) => i.severity === 'critical' || i.severity === 'high');

    return {
      isAllowed,
      issues,
      statementType,
      tablesAccessed: [...new Set(tablesAccessed)],
    };
  }

  /** Quick check: is this SQL safe to execute? */
  isSafe(sql: string, dialect: string = 'PostgreSQL'): boolean {
    return this.analyze(sql, dialect).isAllowed;
  }

  private mapDialect(dialect: string): string {
    const map: Record<string, string> = {
      PostgreSQL: 'PostgreSQL',
      MySQL: 'MySQL',
      SQLite: 'SQLite',
    };
    return map[dialect] || 'PostgreSQL';
  }

  private extractTables(node: unknown, tables: string[]): void {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;

    if (typeof n.table === 'string') tables.push(n.table);

    if (n.from) {
      const fromList = Array.isArray(n.from) ? n.from : [n.from];
      for (const item of fromList) {
        if (item && typeof item === 'object') {
          const it = item as Record<string, unknown>;
          if (typeof it.table === 'string') tables.push(it.table);
          if (it.expr) this.extractTables(it.expr, tables);
        }
      }
    }

    for (const key of Object.keys(n)) {
      if (key === 'from' || key === 'table') continue;
      const val = n[key];
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

  private detectStatementType(sql: string): string | null {
    const match = sql.trim().match(/^(\w+)\s/i);
    return match ? match[1].toLowerCase() : null;
  }
}
