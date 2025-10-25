/**
 * Optimizer Agent - Query Performance Analysis and Optimization
 */

import {
  Agent,
  OptimizerAgentInput,
  OptimizerAgentOutput,
  QueryAnalysis,
  ExecutionPlan,
  OptimizationSuggestion,
  PerformanceMetrics,
} from '../types';
import { DatabaseConnection } from '../database/connection';
import { BaseLLMProvider } from '../llm';
import { logger } from '../utils/logger';

export class OptimizerAgent implements Agent {
  name = 'OptimizerAgent';
  private db: DatabaseConnection;
  private llm: BaseLLMProvider;
  private performanceThreshold: number = 1000; // ms

  constructor(db: DatabaseConnection, llm: BaseLLMProvider) {
    this.db = db;
    this.llm = llm;
  }

  /**
   * Analyze and optimize SQL query
   */
  async process(input: OptimizerAgentInput): Promise<OptimizerAgentOutput> {
    const { sql, schema } = input;

    logger.info('Analyzing query for optimization', {
      sqlLength: sql.length,
    });

    try {
      // Get execution plan
      const executionPlan = await this.getExecutionPlan(sql);

      // Analyze performance
      const performance = this.extractPerformanceMetrics(executionPlan);

      // Generate suggestions
      const suggestions = await this.generateSuggestions(
        sql,
        executionPlan,
        schema
      );

      const analysis: QueryAnalysis = {
        sql,
        executionPlan,
        suggestions,
        performance,
      };

      // Decide if optimization should be applied
      const shouldOptimize =
        performance.executionTime > this.performanceThreshold &&
        suggestions.some((s) => s.impact === 'high' && s.autoApply);

      let optimizedSQL = sql;
      let applied = false;

      if (shouldOptimize) {
        const optimizationResult = await this.applyOptimizations(
          sql,
          suggestions,
          schema
        );
        optimizedSQL = optimizationResult.sql;
        applied = optimizationResult.applied;
      }

      return {
        optimizedSQL,
        analysis,
        applied,
      };
    } catch (error) {
      logger.error('Query optimization failed', { error });
      // Return original SQL on error
      return {
        optimizedSQL: sql,
        analysis: {
          sql,
          executionPlan: { plan: null, totalCost: 0, estimatedRows: 0 },
          suggestions: [],
          performance: {
            executionTime: 0,
            planningTime: 0,
            rowsReturned: 0,
            buffersHit: 0,
            buffersMissed: 0,
          },
        },
        applied: false,
      };
    }
  }

  /**
   * Get query execution plan using EXPLAIN ANALYZE
   */
  private async getExecutionPlan(sql: string): Promise<ExecutionPlan> {
    try {
      const planData = await this.db.explainQuery(sql);

      if (!planData || planData.length === 0) {
        throw new Error('Empty execution plan');
      }

      const plan = planData[0];

      return {
        plan: plan.Plan,
        totalCost: plan.Plan['Total Cost'] || 0,
        estimatedRows: plan.Plan['Plan Rows'] || 0,
        actualTime: plan['Execution Time'] || 0,
      };
    } catch (error) {
      logger.error('Failed to get execution plan', { error });
      throw error;
    }
  }

  /**
   * Extract performance metrics from execution plan
   */
  private extractPerformanceMetrics(plan: ExecutionPlan): PerformanceMetrics {
    const extractBuffers = (node: any): { hit: number; missed: number } => {
      let hit = 0;
      let missed = 0;

      if (node['Shared Hit Blocks']) hit += node['Shared Hit Blocks'];
      if (node['Shared Read Blocks']) missed += node['Shared Read Blocks'];

      if (node.Plans) {
        for (const child of node.Plans) {
          const childBuffers = extractBuffers(child);
          hit += childBuffers.hit;
          missed += childBuffers.missed;
        }
      }

      return { hit, missed };
    };

    const buffers = plan.plan ? extractBuffers(plan.plan) : { hit: 0, missed: 0 };

    return {
      executionTime: plan.actualTime || 0,
      planningTime: 0, // Not available in basic plan
      rowsReturned: plan.estimatedRows,
      buffersHit: buffers.hit,
      buffersMissed: buffers.missed,
    };
  }

  /**
   * Generate optimization suggestions
   */
  private async generateSuggestions(
    sql: string,
    executionPlan: ExecutionPlan,
    schema: any
  ): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];

    // Analyze execution plan for common issues
    if (executionPlan.plan) {
      this.analyzeExecutionPlanNode(executionPlan.plan, suggestions, schema);
    }

    // Use LLM for advanced optimization suggestions
    try {
      const llmSuggestions = await this.getLLMOptimizationSuggestions(
        sql,
        JSON.stringify(executionPlan.plan, null, 2),
        this.formatSchema(schema)
      );

      suggestions.push(...llmSuggestions);
    } catch (error) {
      logger.warn('LLM optimization suggestions failed', { error });
    }

    return suggestions;
  }

  /**
   * Analyze execution plan node recursively
   */
  private analyzeExecutionPlanNode(
    node: any,
    suggestions: OptimizationSuggestion[],
    schema: any
  ): void {
    // Check for sequential scans on large tables
    if (node['Node Type'] === 'Seq Scan') {
      const tableName = node['Relation Name'];
      const table = schema.tables?.find((t: any) => t.name === tableName);

      if (table && table.rowCount && table.rowCount > 1000) {
        const filter = node['Filter'];
        if (filter) {
          // Extract column names from filter
          const columnMatch = filter.match(/\((\w+)\s*[=<>]/);
          if (columnMatch) {
            const column = columnMatch[1];

            // Check if index exists
            const hasIndex = table.indexes?.some((idx: any) =>
              idx.columns.includes(column)
            );

            if (!hasIndex) {
              suggestions.push({
                type: 'index',
                description: `Create index on ${tableName}.${column} to avoid sequential scan`,
                impact: 'high',
                sql: `CREATE INDEX idx_${tableName}_${column} ON ${tableName}(${column});`,
                autoApply: false,
              });
            }
          }
        }
      }
    }

    // Check for nested loops on large datasets
    if (node['Node Type'] === 'Nested Loop') {
      const rows = node['Plan Rows'] || 0;
      if (rows > 10000) {
        suggestions.push({
          type: 'rewrite',
          description: 'Consider using hash join instead of nested loop for large datasets',
          impact: 'medium',
          autoApply: false,
        });
      }
    }

    // Recursively check child plans
    if (node.Plans) {
      for (const childNode of node.Plans) {
        this.analyzeExecutionPlanNode(childNode, suggestions, schema);
      }
    }
  }

  /**
   * Get optimization suggestions from LLM
   */
  private async getLLMOptimizationSuggestions(
    sql: string,
    executionPlan: string,
    schema: string
  ): Promise<OptimizationSuggestion[]> {
    // Check if LLM has optimizeSQL method
    if ('optimizeSQL' in this.llm && typeof this.llm.optimizeSQL === 'function') {
      const result = await (this.llm as any).optimizeSQL(sql, executionPlan, schema);
      return result.suggestions;
    }

    // Fallback to generic completion
    const messages = [
      {
        role: 'system' as const,
        content: `Analyze this PostgreSQL query and suggest optimizations.

Schema:
${schema}

Execution Plan:
${executionPlan}

Return JSON array of suggestions:
[{
  "type": "index|rewrite|cache|partition",
  "description": "...",
  "impact": "high|medium|low",
  "sql": "CREATE INDEX ..." (optional)
}]`,
      },
      {
        role: 'user' as const,
        content: `Optimize:\n${sql}`,
      },
    ];

    const response = await this.llm.generateCompletion(messages);

    try {
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]);
        return suggestions.map((s: any) => ({
          ...s,
          autoApply: false,
        }));
      }
    } catch (error) {
      logger.warn('Failed to parse LLM optimization suggestions', { error });
    }

    return [];
  }

  /**
   * Apply optimizations to SQL
   */
  private async applyOptimizations(
    sql: string,
    suggestions: OptimizationSuggestion[],
    schema: any
  ): Promise<{ sql: string; applied: boolean }> {
    // For now, we only apply index creation suggestions
    const indexSuggestions = suggestions.filter(
      (s) => s.type === 'index' && s.autoApply && s.sql
    );

    let applied = false;

    for (const suggestion of indexSuggestions) {
      try {
        if (suggestion.sql) {
          await this.db.query(suggestion.sql);
          logger.info('Applied optimization', {
            type: suggestion.type,
            sql: suggestion.sql,
          });
          applied = true;
        }
      } catch (error) {
        logger.error('Failed to apply optimization', {
          sql: suggestion.sql,
          error,
        });
      }
    }

    // For query rewrites, we'd need to use the LLM to rewrite the SQL
    // This is left as an exercise

    return { sql, applied };
  }

  /**
   * Format schema for LLM
   */
  private formatSchema(schema: any): string {
    if (!schema.tables) return 'No schema available';

    let text = '';
    for (const table of schema.tables) {
      text += `Table: ${table.name}\n`;
      text += `Columns: ${table.columns.map((c: any) => `${c.name} ${c.type}`).join(', ')}\n`;
      if (table.indexes && table.indexes.length > 0) {
        text += `Indexes: ${table.indexes.map((i: any) => i.name).join(', ')}\n`;
      }
      text += '\n';
    }
    return text;
  }

  /**
   * Set performance threshold in milliseconds
   */
  setPerformanceThreshold(ms: number): void {
    this.performanceThreshold = ms;
  }
}
