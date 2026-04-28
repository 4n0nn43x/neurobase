/**
 * Destructive-query detection: DELETE / UPDATE / TRUNCATE that would touch
 * every row, plus regex fallbacks when the AST parse fails.
 */

import type { SecurityIssue } from './types';

interface AstNode {
  where?: unknown;
}

/** Apply against a parsed AST node + its statement type. */
export function checkAstDestructive(node: AstNode, stmtType: string | null): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  if (stmtType === 'delete' && !node.where) {
    issues.push({
      severity: 'critical',
      message: 'DELETE without WHERE clause — would delete ALL rows',
      category: 'destructive',
    });
  }

  if (stmtType === 'update' && !node.where) {
    issues.push({
      severity: 'high',
      message: 'UPDATE without WHERE clause — would update ALL rows',
      category: 'destructive',
    });
  }

  return issues;
}

/** Regex fallback for when the AST parse fails. */
export function checkRegexDestructive(sql: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  // DELETE FROM table; (no WHERE)
  if (/DELETE\s+FROM\s+\w+\s*$/i.test(sql.trim())) {
    issues.push({
      severity: 'critical',
      message: 'DELETE without WHERE clause',
      category: 'destructive',
    });
  }

  // UPDATE table SET ... ; (no WHERE)
  if (/UPDATE\s+\w+\s+SET\s+[^;]+$/i.test(sql.trim()) && !/\bWHERE\b/i.test(sql)) {
    issues.push({
      severity: 'high',
      message: 'UPDATE without WHERE clause',
      category: 'destructive',
    });
  }

  if (/^\s*TRUNCATE\b/i.test(sql)) {
    issues.push({
      severity: 'critical',
      message: 'TRUNCATE statement — removes all rows without WHERE',
      category: 'destructive',
    });
  }

  return issues;
}
