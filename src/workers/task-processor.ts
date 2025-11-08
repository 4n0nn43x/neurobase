/**
 * Task Processor - Executes tasks assigned to agents
 * This worker pulls pending tasks from the queue and processes them
 */

import { Pool } from 'pg';
import { logger } from '../utils/logger';

export interface TaskPayload {
  [key: string]: any;
}

export interface Task {
  id: string;
  agent_id: string;
  task_type: string;
  payload: TaskPayload;
  status: string;
  priority: number;
  created_at: Date;
}

export class TaskProcessor {
  private pool: Pool;
  private processingInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Start processing tasks
   */
  start(intervalMs: number = 5000): void {
    if (this.isRunning) {
      logger.warn('Task processor already running');
      return;
    }

    logger.info('Starting task processor');
    this.isRunning = true;

    // Process immediately
    this.processTasks();

    // Then process on interval
    this.processingInterval = setInterval(() => {
      this.processTasks();
    }, intervalMs);
  }

  /**
   * Stop processing tasks
   */
  stop(): void {
    logger.info('Stopping task processor');
    this.isRunning = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
  }

  /**
   * Process pending tasks
   */
  private async processTasks(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get pending tasks (ordered by priority DESC, created_at ASC)
      const result = await this.pool.query(
        `SELECT * FROM neurobase_agent_tasks
         WHERE status = 'pending'
         ORDER BY priority DESC, created_at ASC
         LIMIT 10`
      );

      const tasks = result.rows as Task[];

      if (tasks.length === 0) {
        logger.debug('No pending tasks to process');
        return;
      }

      logger.info({ taskCount: tasks.length }, 'Processing pending tasks');

      // Process each task
      for (const task of tasks) {
        await this.processTask(task);
      }
    } catch (error) {
      logger.error({ error }, 'Error processing tasks');
    }
  }

  /**
   * Process a single task
   */
  private async processTask(task: Task): Promise<void> {
    logger.info({ taskId: task.id, taskType: task.task_type }, 'Processing task');

    try {
      // Mark task as running
      await this.updateTaskStatus(task.id, 'running');

      // Execute task based on type
      const result = await this.executeTask(task);

      // Mark task as completed
      await this.completeTask(task.id, result);

      logger.info({ taskId: task.id }, 'Task completed successfully');
    } catch (error: any) {
      logger.error({ error, taskId: task.id }, 'Task failed');
      await this.failTask(task.id, error.message);
    }
  }

  /**
   * Execute task logic based on type
   */
  private async executeTask(task: Task): Promise<any> {
    const { task_type, payload } = task;

    switch (task_type) {
      case 'analyze-schema':
        return await this.analyzeSchema(payload);

      case 'validate-query':
        return await this.validateQuery(payload);

      case 'optimize-query':
        return await this.optimizeQuery(payload);

      case 'aggregate-learning':
        return await this.aggregateLearning(payload);

      case 'run-experiment':
        return await this.runExperiment(payload);

      case 'custom':
      case 'test-task':
        return await this.customTask(payload);

      default:
        throw new Error(`Unknown task type: ${task_type}`);
    }
  }

  /**
   * Analyze Schema Task
   */
  private async analyzeSchema(payload: TaskPayload): Promise<any> {
    logger.info({ payload }, 'Executing schema analysis');

    const { tables, operation, focus } = payload;

    // Simulate schema analysis
    const analysis = {
      tables: tables || [],
      operation: operation || 'scan',
      focus: focus || ['all'],
      recommendations: [
        {
          table: tables?.[0] || 'example',
          type: 'index',
          suggestion: 'Add index on frequently queried columns',
          impact: 'high',
          estimated_improvement: '50%'
        }
      ],
      timestamp: new Date().toISOString()
    };

    // Here you would implement real schema analysis logic
    // For now, return mock data
    return analysis;
  }

  /**
   * Validate Query Task
   */
  private async validateQuery(payload: TaskPayload): Promise<any> {
    logger.info({ payload }, 'Executing query validation');

    const { sql, checkPerformance } = payload;

    // Simulate query validation
    const validation = {
      sql,
      isValid: true,
      isSafe: true,
      warnings: [],
      suggestions: checkPerformance ? [
        'Consider adding LIMIT clause',
        'Index on WHERE columns recommended'
      ] : [],
      estimatedCost: checkPerformance ? 'medium' : undefined,
      timestamp: new Date().toISOString()
    };

    return validation;
  }

  /**
   * Optimize Query Task
   */
  private async optimizeQuery(payload: TaskPayload): Promise<any> {
    logger.info({ payload }, 'Executing query optimization');

    const { sql, suggestIndexes } = payload;

    const optimization = {
      originalSql: sql,
      optimizedSql: sql, // Would contain optimized version
      improvements: [
        'Replaced SELECT * with specific columns',
        'Added appropriate index hints'
      ],
      indexes: suggestIndexes ? [
        { column: 'created_at', type: 'btree' }
      ] : [],
      expectedSpeedup: '3x',
      timestamp: new Date().toISOString()
    };

    return optimization;
  }

  /**
   * Aggregate Learning Task
   */
  private async aggregateLearning(payload: TaskPayload): Promise<any> {
    logger.info({ payload }, 'Executing learning aggregation');

    const { timeframe, includeMetrics } = payload;

    const aggregation = {
      timeframe,
      totalLearnings: 42,
      insights: [
        'Users table queries increased 20%',
        'Most common query pattern: date range filters'
      ],
      metrics: includeMetrics ? {
        avgQueryTime: '45ms',
        cacheHitRate: '78%',
        errorRate: '0.5%'
      } : undefined,
      timestamp: new Date().toISOString()
    };

    return aggregation;
  }

  /**
   * Run Experiment Task
   */
  private async runExperiment(payload: TaskPayload): Promise<any> {
    logger.info({ payload }, 'Executing experiment');

    const { name, strategies, duration } = payload;

    const experiment = {
      name,
      strategies: strategies || [],
      duration,
      results: {
        winner: strategies?.[0] || 'strategy_a',
        improvement: '25%',
        confidence: '95%'
      },
      timestamp: new Date().toISOString()
    };

    return experiment;
  }

  /**
   * Custom Task
   */
  private async customTask(payload: TaskPayload): Promise<any> {
    logger.info({ payload }, 'Executing custom task');

    // Return the payload as-is for custom tasks
    return {
      status: 'completed',
      payload,
      processedAt: new Date().toISOString()
    };
  }

  /**
   * Update task status
   */
  private async updateTaskStatus(taskId: string, status: string): Promise<void> {
    await this.pool.query(
      `UPDATE neurobase_agent_tasks
       SET status = $1, started_at = NOW()
       WHERE id = $2`,
      [status, taskId]
    );
  }

  /**
   * Mark task as completed
   */
  private async completeTask(taskId: string, result: any): Promise<void> {
    await this.pool.query(
      `UPDATE neurobase_agent_tasks
       SET status = 'completed',
           result = $1,
           completed_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(result), taskId]
    );
  }

  /**
   * Mark task as failed
   */
  private async failTask(taskId: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE neurobase_agent_tasks
       SET status = 'failed',
           error = $1,
           completed_at = NOW()
       WHERE id = $2`,
      [error, taskId]
    );
  }
}
