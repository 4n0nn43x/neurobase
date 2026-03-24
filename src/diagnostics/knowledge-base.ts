/**
 * Diagnostic Knowledge Base (Phase 4A)
 * Inspired by D-Bot (Tsinghua, VLDB)
 *
 * Tree of diagnostic nodes for systematic root cause analysis.
 */

export interface DiagNode {
  id: string;
  name: string;
  description: string;
  /** SQL to run for this diagnostic check */
  diagnosticQuery: string;
  /** Evaluates the query result; returns true if this branch applies */
  evaluate: (rows: any[], rowCount: number) => boolean;
  /** Human-readable recommendation if this node matches */
  recommendation: string;
  /** Child nodes to check if this node matches */
  children?: DiagNode[];
}

/**
 * Build the diagnostic knowledge tree for query performance issues.
 * @param sql The SQL query being diagnosed
 * @param tableName Primary table name (extracted from SQL)
 */
export function buildDiagnosticTree(sql: string, tableName: string): DiagNode {
  return {
    id: 'root',
    name: 'Query Performance Diagnostic',
    description: 'Root diagnostic node',
    diagnosticQuery: `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
    evaluate: () => true,
    recommendation: '',
    children: [
      {
        id: 'seq-scan',
        name: 'Sequential Scan Detection',
        description: 'Check if the query performs a sequential scan on a large table',
        diagnosticQuery: `EXPLAIN (FORMAT JSON) ${sql}`,
        evaluate: (rows) => {
          const planText = JSON.stringify(rows);
          return planText.includes('"Seq Scan"') || planText.includes('"Node Type": "Seq Scan"');
        },
        recommendation: 'Sequential scan detected. Consider adding an index on the filtered columns.',
        children: [
          {
            id: 'missing-index',
            name: 'Missing Index',
            description: 'Check if relevant indexes exist',
            diagnosticQuery: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '${tableName}'`,
            evaluate: (rows) => rows.length === 0 || rows.length < 2,
            recommendation: `Table "${tableName}" has few or no indexes. Add indexes on columns used in WHERE, JOIN, and ORDER BY clauses.`,
          },
          {
            id: 'stale-stats',
            name: 'Stale Statistics',
            description: 'Check if table statistics are outdated',
            diagnosticQuery: `SELECT last_analyze, last_autoanalyze, n_live_tup, n_dead_tup FROM pg_stat_user_tables WHERE relname = '${tableName}'`,
            evaluate: (rows) => {
              if (rows.length === 0) return false;
              const row = rows[0];
              const deadRatio = row.n_dead_tup / Math.max(row.n_live_tup, 1);
              return deadRatio > 0.2;
            },
            recommendation: `High dead tuple ratio on "${tableName}". Run VACUUM ANALYZE to update statistics and reclaim space.`,
          },
        ],
      },
      {
        id: 'lock-contention',
        name: 'Lock Contention',
        description: 'Check for lock contention issues',
        diagnosticQuery: `SELECT mode, COUNT(*) as lock_count FROM pg_locks WHERE relation = '${tableName}'::regclass GROUP BY mode`,
        evaluate: (rows) => rows.some((r: any) => r.lock_count > 5),
        recommendation: 'Lock contention detected. Consider reducing transaction duration, using row-level locks, or adjusting connection pool settings.',
      },
      {
        id: 'large-result',
        name: 'Large Result Set',
        description: 'Check if the query returns too many rows',
        diagnosticQuery: `SELECT reltuples::bigint as estimated_rows FROM pg_class WHERE relname = '${tableName}'`,
        evaluate: (rows) => {
          if (rows.length === 0) return false;
          return rows[0].estimated_rows > 100000 && !sql.toUpperCase().includes('LIMIT');
        },
        recommendation: 'Query may return a very large result set. Add LIMIT clause or implement pagination.',
      },
      {
        id: 'complex-joins',
        name: 'Complex Joins',
        description: 'Check for excessive joins',
        diagnosticQuery: `EXPLAIN (FORMAT JSON) ${sql}`,
        evaluate: (rows) => {
          const planText = JSON.stringify(rows);
          const joinCount = (planText.match(/"Join"/g) || []).length +
                           (planText.match(/"Nested Loop"/g) || []).length +
                           (planText.match(/"Hash Join"/g) || []).length +
                           (planText.match(/"Merge Join"/g) || []).length;
          return joinCount >= 3;
        },
        recommendation: 'Multiple joins detected. Consider using a materialized view for this query pattern, or breaking it into simpler queries.',
      },
      {
        id: 'table-bloat',
        name: 'Table Bloat',
        description: 'Check for table bloat from unvacuumed dead tuples',
        diagnosticQuery: `SELECT pg_size_pretty(pg_total_relation_size('${tableName}')) as total_size, pg_size_pretty(pg_relation_size('${tableName}')) as data_size`,
        evaluate: () => false, // Informational only
        recommendation: 'Check table size relative to expected data volume. Run VACUUM FULL if significantly bloated.',
      },
    ],
  };
}
