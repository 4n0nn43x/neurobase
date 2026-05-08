/**
 * Diagnostic Tree Search (Phase 4A)
 * Inspired by D-Bot (Tsinghua, VLDB)
 *
 * Systematic root cause analysis for slow/failing queries
 * using a knowledge-base tree of diagnostic checks.
 */

import { DatabaseAdapter } from '../database/adapter';
import { DiagnosticResult } from '../types';
import { DiagNode, buildDiagnosticTree } from './knowledge-base';
import { logger } from '../utils/logger';

export class DiagnosticTreeSearch {
  private adapter: DatabaseAdapter;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
  }

  /**
   * Diagnose a SQL query by traversing the diagnostic tree
   */
  async diagnose(sql: string): Promise<DiagnosticResult> {
    // The diagnostic knowledge base relies on PostgreSQL-specific introspection:
    // pg_indexes / pg_stat_user_tables, JSON EXPLAIN output, etc. Return a
    // clear, structured result on other engines instead of letting the queries
    // fail one by one with cryptic syntax errors.
    const engineName = this.adapter.getDialectName?.() ?? 'PostgreSQL';
    if (engineName !== 'PostgreSQL') {
      return {
        rootCause: `Diagnostic tree-search is currently PostgreSQL-only (active engine: ${engineName})`,
        path: [],
        recommendations: [
          'Run this query against a PostgreSQL database to use the diagnostic tree',
          'Or use `EXPLAIN` directly via your engine\'s native tooling',
        ],
        details: { sql, engine: engineName },
      };
    }

    const tableName = this.extractPrimaryTable(sql);
    if (!tableName) {
      return {
        rootCause: 'Unable to identify primary table from query',
        path: [],
        recommendations: ['Ensure the query references valid table names'],
        details: { sql },
      };
    }

    const tree = buildDiagnosticTree(sql, tableName);
    const path: string[] = [];
    const recommendations: string[] = [];
    const details: Record<string, any> = { sql, primaryTable: tableName };

    await this.traverse(tree, path, recommendations, details);

    return {
      rootCause: recommendations.length > 0
        ? `Found ${recommendations.length} issue(s) for query on "${tableName}"`
        : 'No significant issues detected',
      path,
      recommendations,
      details,
    };
  }

  private async traverse(
    node: DiagNode,
    path: string[],
    recommendations: string[],
    details: Record<string, any>
  ): Promise<void> {
    try {
      const result = await this.adapter.query(node.diagnosticQuery);
      const matches = node.evaluate(result.rows, result.rowCount || 0);

      if (matches) {
        path.push(node.name);
        details[node.id] = {
          matched: true,
          data: result.rows.slice(0, 5),
        };

        if (node.recommendation) {
          recommendations.push(node.recommendation);
        }

        // Traverse children
        if (node.children) {
          for (const child of node.children) {
            await this.traverse(child, path, recommendations, details);
          }
        }
      }
    } catch (error) {
      logger.debug({
        nodeId: node.id,
        error: error instanceof Error ? error.message : String(error),
      }, 'Diagnostic node query failed');

      details[node.id] = {
        matched: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private extractPrimaryTable(sql: string): string | null {
    // Extract first table from FROM clause
    const fromMatch = sql.match(/FROM\s+["']?(\w+)["']?/i);
    if (fromMatch) return fromMatch[1];

    // Try UPDATE
    const updateMatch = sql.match(/UPDATE\s+["']?(\w+)["']?/i);
    if (updateMatch) return updateMatch[1];

    // Try INSERT INTO
    const insertMatch = sql.match(/INTO\s+["']?(\w+)["']?/i);
    if (insertMatch) return insertMatch[1];

    return null;
  }
}
