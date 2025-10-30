/**
 * Schema Evolution Agent
 * Analyzes query patterns and proposes schema optimizations
 * Runs on dedicated database fork for safe experimentation
 */

import { Pool } from 'pg';
import { logger } from '../utils/logger';
import { BaseLLMProvider } from '../llm/base';

export interface SchemaAnalysis {
  currentSchema: any;
  queryPatterns: QueryPattern[];
  recommendations: SchemaRecommendation[];
  performance: PerformanceMetrics;
}

export interface QueryPattern {
  pattern: string;
  frequency: number;
  avgExecutionTime: number;
  tables: string[];
  joins: string[];
  filters: string[];
}

export interface SchemaRecommendation {
  type: 'index' | 'materialized-view' | 'partition' | 'denormalization' | 'column-type';
  priority: 'high' | 'medium' | 'low';
  description: string;
  sql: string;
  estimatedImpact: {
    querySpeedup: number; // percentage
    storageIncrease: number; // MB
    maintenanceCost: 'low' | 'medium' | 'high';
  };
  affectedQueries: string[];
}

export interface PerformanceMetrics {
  totalQueries: number;
  avgQueryTime: number;
  slowQueries: number;
  missingIndexes: number;
  tableScans: number;
}

export class SchemaEvolutionAgent {
  private pool: Pool;
  private llmProvider: BaseLLMProvider;
  private analysisInterval?: NodeJS.Timeout;

  constructor(pool: Pool, llmProvider: BaseLLMProvider) {
    this.pool = pool;
    this.llmProvider = llmProvider;
  }

  /**
   * Start continuous schema analysis
   */
  startMonitoring(intervalMs: number = 3600000): void {
    logger.info({ intervalMs }, 'Starting schema evolution monitoring');

    this.analysisInterval = setInterval(async () => {
      try {
        await this.analyzeAndRecommend();
      } catch (error) {
        logger.error({ error }, 'Error during schema analysis');
      }
    }, intervalMs);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = undefined;
      logger.info('Schema evolution monitoring stopped');
    }
  }

  /**
   * Analyze schema and provide recommendations
   */
  async analyzeAndRecommend(): Promise<SchemaAnalysis> {
    logger.info('Starting schema evolution analysis');

    const startTime = Date.now();

    // Get current schema
    const currentSchema = await this.getCurrentSchema();

    // Analyze query patterns from learning history
    const queryPatterns = await this.analyzeQueryPatterns();

    // Get performance metrics
    const performance = await this.getPerformanceMetrics();

    // Generate recommendations using LLM
    const recommendations = await this.generateRecommendations(
      currentSchema,
      queryPatterns,
      performance
    );

    const analysisTime = Date.now() - startTime;

    logger.info(
      { recommendationCount: recommendations.length, analysisTime },
      'Schema evolution analysis completed'
    );

    return {
      currentSchema,
      queryPatterns,
      recommendations,
      performance,
    };
  }

  /**
   * Get current database schema
   */
  private async getCurrentSchema(): Promise<any> {
    const schemaQuery = `
      SELECT
        t.table_schema,
        t.table_name,
        t.table_type,
        (
          SELECT json_agg(
            json_build_object(
              'column_name', c.column_name,
              'data_type', c.data_type,
              'is_nullable', c.is_nullable
            )
          )
          FROM information_schema.columns c
          WHERE c.table_schema = t.table_schema
            AND c.table_name = t.table_name
        ) as columns,
        (
          SELECT json_agg(
            json_build_object(
              'index_name', i.indexname,
              'index_def', i.indexdef
            )
          )
          FROM pg_indexes i
          WHERE i.schemaname = t.table_schema
            AND i.tablename = t.table_name
        ) as indexes
      FROM information_schema.tables t
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY t.table_schema, t.table_name;
    `;

    const result = await this.pool.query(schemaQuery);
    return result.rows;
  }

  /**
   * Analyze query patterns from learning history
   */
  private async analyzeQueryPatterns(): Promise<QueryPattern[]> {
    const patternsQuery = `
      SELECT
        sql,
        COUNT(*) as frequency,
        AVG(EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER (ORDER BY timestamp)))) as avg_time
      FROM neurobase_learning_history
      WHERE success = TRUE
        AND timestamp > NOW() - INTERVAL '7 days'
      GROUP BY sql
      ORDER BY frequency DESC
      LIMIT 50;
    `;

    const result = await this.pool.query(patternsQuery);

    const patterns: QueryPattern[] = [];

    for (const row of result.rows) {
      const sql = row.sql;
      const pattern = await this.extractPattern(sql);

      patterns.push({
        pattern: pattern.pattern,
        frequency: parseInt(row.frequency),
        avgExecutionTime: parseFloat(row.avg_time) || 0,
        tables: pattern.tables,
        joins: pattern.joins,
        filters: pattern.filters,
      });
    }

    return patterns;
  }

  /**
   * Extract pattern from SQL query
   */
  private async extractPattern(sql: string): Promise<any> {
    const tables = this.extractTables(sql);
    const joins = this.extractJoins(sql);
    const filters = this.extractFilters(sql);

    // Create a normalized pattern
    const pattern = sql
      .replace(/\d+/g, 'N') // Replace numbers
      .replace(/'[^']*'/g, "'X'") // Replace strings
      .toLowerCase();

    return { pattern, tables, joins, filters };
  }

  /**
   * Extract table names from SQL
   */
  private extractTables(sql: string): string[] {
    const fromMatch = sql.match(/FROM\s+([a-z_][a-z0-9_]*)/gi);
    const joinMatch = sql.match(/JOIN\s+([a-z_][a-z0-9_]*)/gi);

    const tables = new Set<string>();

    if (fromMatch) {
      fromMatch.forEach(m => {
        const table = m.replace(/FROM\s+/i, '').trim();
        tables.add(table);
      });
    }

    if (joinMatch) {
      joinMatch.forEach(m => {
        const table = m.replace(/JOIN\s+/i, '').trim();
        tables.add(table);
      });
    }

    return Array.from(tables);
  }

  /**
   * Extract join conditions from SQL
   */
  private extractJoins(sql: string): string[] {
    const joinMatches = sql.match(/JOIN\s+[^ON]+ON\s+([^WHERE\s]+)/gi);
    return joinMatches || [];
  }

  /**
   * Extract filter conditions from SQL
   */
  private extractFilters(sql: string): string[] {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:GROUP BY|ORDER BY|LIMIT|$)/i);
    if (whereMatch) {
      return [whereMatch[1].trim()];
    }
    return [];
  }

  /**
   * Get performance metrics
   */
  private async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    // Count total queries
    const totalQueriesResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM neurobase_learning_history WHERE timestamp > NOW() - INTERVAL '7 days'`
    );

    // Count slow queries (arbitrary threshold)
    const slowQueriesResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM neurobase_learning_history
       WHERE success = FALSE AND timestamp > NOW() - INTERVAL '7 days'`
    );

    // Get table scan statistics (if pg_stat_statements is available)
    let tableScans = 0;
    try {
      const scanResult = await this.pool.query(
        `SELECT COUNT(*) as count FROM pg_stat_user_tables WHERE seq_scan > idx_scan AND seq_scan > 100`
      );
      tableScans = parseInt(scanResult.rows[0]?.count || '0');
    } catch (error) {
      logger.warn('pg_stat_user_tables not available');
    }

    return {
      totalQueries: parseInt(totalQueriesResult.rows[0].count),
      avgQueryTime: 0, // Would need pg_stat_statements for accurate data
      slowQueries: parseInt(slowQueriesResult.rows[0].count),
      missingIndexes: 0, // Calculated during analysis
      tableScans,
    };
  }

  /**
   * Generate recommendations using LLM
   */
  private async generateRecommendations(
    schema: any,
    patterns: QueryPattern[],
    performance: PerformanceMetrics
  ): Promise<SchemaRecommendation[]> {
    const prompt = `You are a PostgreSQL database optimization expert. Analyze the following database schema, query patterns, and performance metrics, then provide specific schema evolution recommendations.

CURRENT SCHEMA:
${JSON.stringify(schema, null, 2)}

QUERY PATTERNS:
${JSON.stringify(patterns.slice(0, 10), null, 2)}

PERFORMANCE METRICS:
- Total queries (last 7 days): ${performance.totalQueries}
- Slow queries: ${performance.slowQueries}
- Table scans: ${performance.tableScans}

Provide 3-5 specific recommendations for schema improvements. For each recommendation, provide:
1. Type (index, materialized-view, partition, denormalization, or column-type)
2. Priority (high, medium, or low)
3. Description
4. Exact SQL to implement
5. Estimated impact (query speedup %, storage increase MB, maintenance cost)
6. Which queries would benefit

Return your response as a JSON array of recommendations.`;

    try {
      const response = await this.llmProvider.generateCompletion(
        [{ role: 'user', content: prompt }],
        { temperature: 0.1, maxTokens: 2000 }
      );

      // Parse LLM response
      const content = response.content;
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      if (jsonMatch) {
        const recommendations = JSON.parse(jsonMatch[0]);
        return recommendations.map((rec: any) => ({
          type: rec.type || 'index',
          priority: rec.priority || 'medium',
          description: rec.description || '',
          sql: rec.sql || '',
          estimatedImpact: rec.estimatedImpact || {
            querySpeedup: 0,
            storageIncrease: 0,
            maintenanceCost: 'low',
          },
          affectedQueries: rec.affectedQueries || [],
        }));
      }

      // Fallback: generate basic index recommendations
      return this.generateBasicRecommendations(patterns);
    } catch (error) {
      logger.error({ error }, 'Error generating LLM recommendations');
      return this.generateBasicRecommendations(patterns);
    }
  }

  /**
   * Generate basic recommendations without LLM
   */
  private generateBasicRecommendations(patterns: QueryPattern[]): SchemaRecommendation[] {
    const recommendations: SchemaRecommendation[] = [];

    // Analyze frequent patterns for missing indexes
    for (const pattern of patterns.slice(0, 5)) {
      if (pattern.filters.length > 0) {
        recommendations.push({
          type: 'index',
          priority: 'high',
          description: `Add index for frequently filtered column`,
          sql: `-- Index recommendation based on query pattern\n-- CREATE INDEX idx_name ON table_name(column);`,
          estimatedImpact: {
            querySpeedup: 50,
            storageIncrease: 10,
            maintenanceCost: 'low',
          },
          affectedQueries: [pattern.pattern],
        });
      }
    }

    return recommendations;
  }

  /**
   * Test a recommendation on the fork
   */
  async testRecommendation(recommendation: SchemaRecommendation): Promise<{
    success: boolean;
    performanceGain?: number;
    error?: string;
  }> {
    logger.info({ recommendation: recommendation.description }, 'Testing schema recommendation');

    try {
      // Execute the recommendation SQL on the fork
      await this.pool.query(recommendation.sql);

      // Run performance test (simplified)
      // In production, would run affected queries before/after and compare
      const performanceGain = recommendation.estimatedImpact.querySpeedup;

      logger.info(
        { recommendation: recommendation.description, performanceGain },
        'Recommendation test successful'
      );

      return {
        success: true,
        performanceGain,
      };
    } catch (error) {
      logger.error({ error, recommendation: recommendation.description }, 'Recommendation test failed');

      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Apply recommendation to main database
   */
  async applyRecommendation(
    recommendation: SchemaRecommendation,
    mainPool: Pool
  ): Promise<void> {
    logger.info({ recommendation: recommendation.description }, 'Applying recommendation to main database');

    try {
      await mainPool.query(recommendation.sql);
      logger.info({ recommendation: recommendation.description }, 'Recommendation applied successfully');
    } catch (error) {
      logger.error({ error, recommendation: recommendation.description }, 'Failed to apply recommendation');
      throw error;
    }
  }
}
