/**
 * Auto-Indexer
 * Monitors query patterns and suggests/creates indexes automatically
 */

import { DatabaseAdapter } from '../database/adapter';
import { logger } from '../utils/logger';

export interface IndexSuggestion {
  table: string;
  columns: string[];
  reason: string;
  occurrences: number;
  estimatedImpact: 'high' | 'medium' | 'low';
  sql: string;
  autoApply: boolean;
}

interface ColumnScanRecord {
  table: string;
  column: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
}

export class AutoIndexer {
  private adapter: DatabaseAdapter;
  private seqScanTracker: Map<string, ColumnScanRecord> = new Map();
  private suggestions: IndexSuggestion[] = [];
  private thresholdOccurrences = 5; // Suggest after N seq scans
  private dialect: string;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
    this.dialect = adapter.getDialectName();
  }

  /**
   * Record a sequential scan observation from an EXPLAIN plan
   */
  recordSeqScan(table: string, column: string): void {
    const key = `${table}.${column}`;
    const existing = this.seqScanTracker.get(key);

    if (existing) {
      existing.count++;
      existing.lastSeen = new Date();
    } else {
      this.seqScanTracker.set(key, {
        table,
        column,
        count: 1,
        firstSeen: new Date(),
        lastSeen: new Date(),
      });
    }

    // Check if we should suggest an index
    const record = this.seqScanTracker.get(key)!;
    if (record.count >= this.thresholdOccurrences) {
      this.suggestIndex(table, [column], record.count);
    }
  }

  /**
   * Analyze an EXPLAIN plan and track seq scans
   */
  analyzePlan(plan: any): void {
    if (!plan) return;
    this.walkPlan(plan);
  }

  private walkPlan(node: any): void {
    if (!node || typeof node !== 'object') return;

    // Check for Seq Scan nodes
    if (node['Node Type'] === 'Seq Scan' && node['Relation Name']) {
      const table = node['Relation Name'];
      const filter = node['Filter'] || '';

      // Extract column names from filter
      const columnMatches = filter.matchAll(/\((\w+)\s*[=<>!]/g);
      for (const match of columnMatches) {
        this.recordSeqScan(table, match[1]);
      }
    }

    // Recursively check child plans
    if (node.Plans && Array.isArray(node.Plans)) {
      for (const child of node.Plans) {
        this.walkPlan(child);
      }
    }

    // Handle JSON format
    if (node.Plan) {
      this.walkPlan(node.Plan);
    }
  }

  private suggestIndex(table: string, columns: string[], occurrences: number): void {
    // Don't duplicate suggestions
    if (this.suggestions.some(s => s.table === table && s.columns.join(',') === columns.join(','))) {
      return;
    }

    const colList = columns.join(', ');
    const indexName = `idx_auto_${table}_${columns.join('_')}`;

    let sql: string;
    if (this.dialect === 'PostgreSQL') {
      sql = `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON ${table}(${colList})`;
    } else {
      sql = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${table}(${colList})`;
    }

    this.suggestions.push({
      table,
      columns,
      reason: `Sequential scan detected ${occurrences} times on ${table}.${colList}`,
      occurrences,
      estimatedImpact: occurrences > 20 ? 'high' : occurrences > 10 ? 'medium' : 'low',
      sql,
      autoApply: false,
    });

    logger.info({ table, columns, occurrences }, 'Auto-indexer: new index suggestion');
  }

  /**
   * Get all current index suggestions
   */
  getSuggestions(): IndexSuggestion[] {
    return [...this.suggestions];
  }

  /**
   * Apply an index suggestion
   */
  async applyIndex(suggestion: IndexSuggestion): Promise<boolean> {
    try {
      await this.adapter.query(suggestion.sql);
      logger.info({ sql: suggestion.sql }, 'Auto-indexer: index created');

      // Remove from suggestions
      this.suggestions = this.suggestions.filter(s => s.sql !== suggestion.sql);
      return true;
    } catch (error) {
      logger.error({ error, sql: suggestion.sql }, 'Auto-indexer: failed to create index');
      return false;
    }
  }

  /**
   * Detect unused indexes (PostgreSQL only)
   */
  async findUnusedIndexes(_minAgeDays: number = 30): Promise<Array<{ name: string; table: string; size: string }>> {
    if (this.dialect !== 'PostgreSQL') return [];

    try {
      const result = await this.adapter.query(`
        SELECT
          schemaname || '.' || indexrelname AS index_name,
          schemaname || '.' || relname AS table_name,
          pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
          idx_scan
        FROM pg_stat_user_indexes
        WHERE idx_scan = 0
          AND indexrelname NOT LIKE '%_pkey'
          AND schemaname = 'public'
        ORDER BY pg_relation_size(indexrelid) DESC
      `);

      return result.rows.map((r: any) => ({
        name: r.index_name,
        table: r.table_name,
        size: r.index_size,
      }));
    } catch {
      return [];
    }
  }

  getStats(): { trackedColumns: number; pendingSuggestions: number } {
    return {
      trackedColumns: this.seqScanTracker.size,
      pendingSuggestions: this.suggestions.length,
    };
  }
}
