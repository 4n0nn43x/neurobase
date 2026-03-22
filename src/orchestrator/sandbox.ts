/**
 * Transactional Sandbox
 * Safely tests queries via BEGIN/ROLLBACK without side effects
 */

import { DatabaseAdapter } from '../database/adapter';
import { logger } from '../utils/logger';

export interface SandboxResult {
  success: boolean;
  rowCount?: number;
  executionTimeMs: number;
  error?: string;
  plan?: any;
}

export class TransactionalSandbox {
  private adapter: DatabaseAdapter;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
  }

  /**
   * Execute a query in sandbox mode (BEGIN -> execute -> ROLLBACK)
   * Returns stats without committing any changes
   */
  async testQuery(sql: string, params?: any[]): Promise<SandboxResult> {
    const startTime = Date.now();

    try {
      const tx = await this.adapter.beginTransaction();

      try {
        const result = await tx.query(sql, params);
        const executionTimeMs = Date.now() - startTime;

        // Always rollback
        await tx.rollback();

        logger.debug({ sql: sql.substring(0, 80), executionTimeMs, rowCount: result.rowCount }, 'Sandbox test complete');

        return {
          success: true,
          rowCount: result.rowCount,
          executionTimeMs,
        };
      } catch (error: any) {
        await tx.rollback();
        return {
          success: false,
          executionTimeMs: Date.now() - startTime,
          error: error.message,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        executionTimeMs: Date.now() - startTime,
        error: `Failed to start transaction: ${error.message}`,
      };
    }
  }

  /**
   * Test query and get EXPLAIN plan
   */
  async testWithPlan(sql: string, params?: any[]): Promise<SandboxResult> {
    const result = await this.testQuery(sql, params);

    if (result.success) {
      try {
        result.plan = await this.adapter.explain(sql, params);
      } catch {
        // EXPLAIN may fail for some queries, that's ok
      }
    }

    return result;
  }

  /**
   * Determine if a query is destructive (modifies data)
   */
  isDestructive(sql: string): boolean {
    const normalized = sql.trim().toUpperCase();
    return /^(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\s/i.test(normalized);
  }
}
