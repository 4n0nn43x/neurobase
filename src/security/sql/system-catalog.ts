/**
 * System-catalog reconnaissance detection.
 *
 * Reading from pg_shadow / pg_authid / pg_roles (PostgreSQL) and similar
 * MySQL/SQLite system tables exposes credentials and grants. NeuroBase
 * should never need to touch these for legitimate user queries.
 */

import type { SecurityIssue } from './types';

const SENSITIVE_PATTERNS = [
  /pg_shadow/i,
  /pg_authid/i,
  /pg_roles/i,
  /mysql\.user/i,
];

export function checkSystemCatalogAccess(sql: string): SecurityIssue[] {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(sql)) {
      return [
        {
          severity: 'high',
          message: 'Access to sensitive system catalogs detected',
          category: 'reconnaissance',
        },
      ];
    }
  }
  return [];
}
