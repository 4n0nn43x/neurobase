/**
 * Query Validator Agent
 * Validates queries before execution on production database
 * Runs on dedicated fork for safe testing
 */

import { Pool } from 'pg';
import { logger } from '../utils/logger';

export interface ValidationResult {
  isValid: boolean;
  isSafe: boolean;
  warnings: string[];
  errors: string[];
  performance: {
    estimatedCost: number;
    estimatedRows: number;
    executionTime?: number;
  };
  recommendations: string[];
}

export interface QueryValidation {
  query: string;
  result: ValidationResult;
  timestamp: Date;
}

export class QueryValidatorAgent {
  private pool: Pool;
  private validationHistory: QueryValidation[] = [];
  private maxHistorySize: number = 1000;

  // Dangerous SQL patterns
  private dangerousPatterns = [
    /DROP\s+(TABLE|DATABASE|SCHEMA)/i,
    /TRUNCATE\s+TABLE/i,
    /DELETE\s+FROM\s+\w+\s*;/i, // DELETE without WHERE
    /UPDATE\s+\w+\s+SET.*?;/i, // UPDATE without WHERE (simplified)
    /ALTER\s+TABLE/i,
    /GRANT|REVOKE/i,
  ];

  // Expensive operation patterns
  private expensivePatterns = [
    /SELECT\s+\*\s+FROM/i,
    /CROSS\s+JOIN/i,
    /NOT\s+IN\s*\(/i,
  ];

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Validate a SQL query
   */
  async validateQuery(sql: string, context?: any): Promise<ValidationResult> {
    logger.info({ sql: sql.substring(0, 100) }, 'Validating query');

    const result: ValidationResult = {
      isValid: false,
      isSafe: true,
      warnings: [],
      errors: [],
      performance: {
        estimatedCost: 0,
        estimatedRows: 0,
      },
      recommendations: [],
    };

    try {
      // 1. Check for dangerous patterns
      this.checkDangerousPatterns(sql, result);

      // 2. Check syntax by running EXPLAIN
      await this.checkSyntax(sql, result);

      // 3. Analyze performance
      await this.analyzePerformance(sql, result);

      // 4. Check for expensive patterns
      this.checkExpensivePatterns(sql, result);

      // 5. Generate recommendations
      this.generateRecommendations(sql, result);

      // Mark as valid if no errors
      result.isValid = result.errors.length === 0;

      // Store in history
      this.validationHistory.push({
        query: sql,
        result,
        timestamp: new Date(),
      });

      // Trim history if needed
      if (this.validationHistory.length > this.maxHistorySize) {
        this.validationHistory.shift();
      }

      logger.info(
        {
          isValid: result.isValid,
          isSafe: result.isSafe,
          warnings: result.warnings.length,
          errors: result.errors.length,
        },
        'Query validation completed'
      );

      return result;
    } catch (error) {
      logger.error({ error, sql }, 'Error during query validation');
      result.errors.push(`Validation error: ${error}`);
      return result;
    }
  }

  /**
   * Check for dangerous SQL patterns
   */
  private checkDangerousPatterns(sql: string, result: ValidationResult): void {
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(sql)) {
        result.isSafe = false;
        result.errors.push(`Dangerous SQL pattern detected: ${pattern.source}`);
      }
    }

    // Check for DELETE/UPDATE without WHERE
    if (/DELETE\s+FROM\s+\w+(?!\s+WHERE)/i.test(sql)) {
      result.isSafe = false;
      result.warnings.push('DELETE without WHERE clause - this will delete ALL rows');
    }

    if (/UPDATE\s+\w+\s+SET.*?(?!\s+WHERE)/i.test(sql) && !sql.includes('WHERE')) {
      result.isSafe = false;
      result.warnings.push('UPDATE without WHERE clause - this will update ALL rows');
    }
  }

  /**
   * Check SQL syntax using EXPLAIN
   */
  private async checkSyntax(sql: string, result: ValidationResult): Promise<void> {
    try {
      // Use EXPLAIN to check syntax without executing
      await this.pool.query(`EXPLAIN ${sql}`);
      // If we get here, syntax is valid
    } catch (error: any) {
      result.errors.push(`Syntax error: ${error.message}`);
    }
  }

  /**
   * Analyze query performance
   */
  private async analyzePerformance(sql: string, result: ValidationResult): Promise<void> {
    try {
      const startTime = Date.now();

      // Run EXPLAIN ANALYZE on fork (safe)
      const explainResult = await this.pool.query(`EXPLAIN (FORMAT JSON, ANALYZE) ${sql}`);

      const executionTime = Date.now() - startTime;

      const plan = explainResult.rows[0]['QUERY PLAN'][0];

      result.performance = {
        estimatedCost: plan['Plan']['Total Cost'] || 0,
        estimatedRows: plan['Plan']['Plan Rows'] || 0,
        executionTime,
      };

      // Check for performance issues
      if (result.performance.estimatedCost > 1000) {
        result.warnings.push(
          `High query cost: ${result.performance.estimatedCost.toFixed(2)} - consider optimization`
        );
      }

      if (result.performance.executionTime && result.performance.executionTime > 5000) {
        result.warnings.push(
          `Slow query: ${result.performance.executionTime}ms - this may timeout on production`
        );
      }

      // Check for table scans
      const planText = JSON.stringify(plan);
      if (planText.includes('Seq Scan')) {
        result.warnings.push('Sequential scan detected - consider adding an index');
      }

      if (planText.includes('Nested Loop') && result.performance.estimatedRows > 10000) {
        result.warnings.push('Nested loop on large dataset - may be slow');
      }
    } catch (error: any) {
      // If EXPLAIN ANALYZE fails, the query might be invalid or too dangerous
      logger.warn({ error }, 'Could not analyze query performance');
      result.warnings.push('Performance analysis failed');
    }
  }

  /**
   * Check for expensive operation patterns
   */
  private checkExpensivePatterns(sql: string, result: ValidationResult): void {
    if (/SELECT\s+\*/i.test(sql)) {
      result.warnings.push('SELECT * detected - consider selecting only needed columns');
    }

    if (/CROSS\s+JOIN/i.test(sql)) {
      result.warnings.push('CROSS JOIN detected - may produce very large result set');
    }

    if (/NOT\s+IN\s*\(/i.test(sql)) {
      result.recommendations.push('Consider using NOT EXISTS instead of NOT IN for better performance');
    }

    if (/OR/i.test(sql) && !sql.includes('||')) {
      result.recommendations.push('Multiple OR conditions may prevent index usage');
    }

    if (/LIKE\s+'%[^%]/i.test(sql)) {
      result.warnings.push('LIKE with leading wildcard prevents index usage');
    }
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(sql: string, result: ValidationResult): void {
    // Recommend LIMIT if not present on SELECT
    if (/SELECT/i.test(sql) && !/LIMIT/i.test(sql)) {
      result.recommendations.push('Consider adding LIMIT clause to prevent large result sets');
    }

    // Recommend specific columns instead of *
    if (/SELECT\s+\*/i.test(sql)) {
      result.recommendations.push('Specify exact columns instead of SELECT * for better performance');
    }

    // Recommend EXISTS over COUNT
    if (/SELECT\s+COUNT\(\*\)\s+FROM.*?>/i.test(sql)) {
      result.recommendations.push('If checking existence, use EXISTS instead of COUNT(*) > 0');
    }

    // Recommend prepared statements
    if (sql.includes("'") && !sql.includes('$1')) {
      result.recommendations.push('Consider using parameterized queries to prevent SQL injection');
    }
  }

  /**
   * Test query execution on fork
   */
  async testQueryExecution(sql: string): Promise<{
    success: boolean;
    rowCount?: number;
    executionTime?: number;
    error?: string;
  }> {
    logger.info('Testing query execution on fork');

    try {
      const startTime = Date.now();

      const result = await this.pool.query(sql);

      const executionTime = Date.now() - startTime;

      logger.info(
        { rowCount: result.rowCount, executionTime },
        'Query execution test successful'
      );

      return {
        success: true,
        rowCount: result.rowCount || 0,
        executionTime,
      };
    } catch (error: any) {
      logger.error({ error }, 'Query execution test failed');

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Batch validate multiple queries
   */
  async batchValidate(queries: string[]): Promise<Map<string, ValidationResult>> {
    logger.info({ count: queries.length }, 'Batch validating queries');

    const results = new Map<string, ValidationResult>();

    for (const query of queries) {
      try {
        const result = await this.validateQuery(query);
        results.set(query, result);
      } catch (error) {
        logger.error({ error, query }, 'Error validating query in batch');
      }
    }

    return results;
  }

  /**
   * Get validation statistics
   */
  getStatistics(): any {
    const total = this.validationHistory.length;
    const valid = this.validationHistory.filter(v => v.result.isValid).length;
    const safe = this.validationHistory.filter(v => v.result.isSafe).length;
    const withWarnings = this.validationHistory.filter(v => v.result.warnings.length > 0).length;
    const withErrors = this.validationHistory.filter(v => v.result.errors.length > 0).length;

    const avgCost = total > 0
      ? this.validationHistory.reduce((sum, v) => sum + v.result.performance.estimatedCost, 0) / total
      : 0;

    return {
      total,
      valid,
      safe,
      withWarnings,
      withErrors,
      validationRate: total > 0 ? (valid / total) * 100 : 0,
      safetyRate: total > 0 ? (safe / total) * 100 : 0,
      avgEstimatedCost: avgCost,
    };
  }

  /**
   * Get validation history
   */
  getHistory(limit: number = 100): QueryValidation[] {
    return this.validationHistory.slice(-limit);
  }

  /**
   * Clear validation history
   */
  clearHistory(): void {
    this.validationHistory = [];
    logger.info('Validation history cleared');
  }
}
