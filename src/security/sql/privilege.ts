/**
 * Privilege-escalation detection: GRANT, REVOKE.
 *
 * NeuroBase never issues these as part of normal text-to-SQL operation.
 * Any presence in the generated query is a strong signal of either an
 * adversarial input or an LLM hallucination that must be rejected.
 */

import type { SecurityIssue } from './types';

const PRIVILEGE_STATEMENTS = new Set(['grant', 'revoke']);

export function checkAstPrivilege(stmtType: string | null): SecurityIssue[] {
  if (stmtType && PRIVILEGE_STATEMENTS.has(stmtType)) {
    return [
      {
        severity: 'critical',
        message: `${stmtType.toUpperCase()} statement detected — privilege escalation attempt`,
        category: 'privilege',
      },
    ];
  }
  return [];
}

export function checkRegexPrivilege(sql: string): SecurityIssue[] {
  if (/^\s*(GRANT|REVOKE)\s/i.test(sql)) {
    return [
      {
        severity: 'critical',
        message: 'Privilege modification detected',
        category: 'privilege',
      },
    ];
  }
  return [];
}
