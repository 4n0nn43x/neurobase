/**
 * Injection-pattern detection.
 *
 * Looks for shape-level signals that suggest the SQL was assembled from
 * untrusted input: multiple statements, comment-stripped keywords, etc.
 * These are NOT exhaustive — parameterised queries upstream are still the
 * real defence. They catch the obvious misuse cases.
 */

import type { SecurityIssue } from './types';

/**
 * Multiple semicolon-separated statements — classic stacked query injection.
 * Split on `;`, drop empty fragments; more than one non-empty piece is suspect.
 */
export function checkMultiStatement(sql: string): SecurityIssue[] {
  const pieces = sql.split(';').filter((s) => s.trim().length > 0);
  if (pieces.length > 1) {
    return [
      {
        severity: 'critical',
        message: 'Multiple statements detected — potential SQL injection',
        category: 'injection',
      },
    ];
  }
  return [];
}

/**
 * SQL comments containing dangerous keywords — a marker of attackers trying
 * to hide payloads after `--` or inside `/* … *\/`.
 */
export function checkCommentInjection(sql: string): SecurityIssue[] {
  if (/--.*\b(DROP|DELETE|INSERT|UPDATE|ALTER|GRANT|REVOKE)\b/i.test(sql)) {
    return [
      {
        severity: 'high',
        message: 'Suspicious SQL comment containing dangerous keywords',
        category: 'injection',
      },
    ];
  }
  return [];
}
