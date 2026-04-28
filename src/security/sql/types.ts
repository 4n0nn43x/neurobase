/**
 * Shared types for the SQL security validators.
 *
 * Each check module exports a pure function that takes the parsed AST node
 * (or raw SQL string for regex fallbacks) and appends SecurityIssue records
 * to an accumulator. The orchestrator in src/security/sql-parser.ts wires
 * them together.
 */

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type IssueCategory =
  | 'injection'
  | 'destructive'
  | 'ddl'
  | 'privilege'
  | 'reconnaissance'
  | 'unknown';

export interface SecurityIssue {
  severity: SecuritySeverity;
  message: string;
  category: IssueCategory;
}

export interface SecurityAnalysis {
  isAllowed: boolean;
  issues: SecurityIssue[];
  statementType: string | null;
  tablesAccessed: string[];
}
