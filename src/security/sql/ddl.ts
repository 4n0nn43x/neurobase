/**
 * DDL detection: CREATE / DROP / ALTER / TRUNCATE / RENAME / COMMENT / COPY.
 *
 * The text-to-SQL path is read/write-data only by design. Schema changes go
 * through a separate explicit flow (init / migrations / agents/schema-evolution).
 * Any DDL in the generated SQL is rejected.
 */

import type { SecurityIssue } from './types';

const DDL_STATEMENTS = new Set([
  'drop', 'truncate', 'alter', 'create',
  'rename', 'comment', 'set', 'reset', 'copy',
]);

export function isDDL(stmtType: string | null): boolean {
  return !!stmtType && DDL_STATEMENTS.has(stmtType);
}

export function checkAstDDL(stmtType: string | null): SecurityIssue[] {
  if (isDDL(stmtType)) {
    return [
      {
        severity: 'critical',
        message: `Blocked statement type: ${stmtType!.toUpperCase()}`,
        category: 'ddl',
      },
    ];
  }
  return [];
}

export function checkRegexDDL(sql: string): SecurityIssue[] {
  if (/^\s*(DROP|TRUNCATE|ALTER|CREATE)\s/i.test(sql)) {
    return [
      {
        severity: 'critical',
        message: 'DDL statement detected',
        category: 'ddl',
      },
    ];
  }
  return [];
}
