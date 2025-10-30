/**
 * A/B Testing Agent
 * Tests different strategies in parallel using multiple forks
 * Compares approaches and recommends best performing strategy
 */

import { Pool } from 'pg';
import { logger } from '../utils/logger';
import { DatabaseForkManager, ForkInfo } from '../database/fork';

export interface ABTestStrategy {
  id: string;
  name: string;
  description: string;
  type: 'sql-generation' | 'optimization' | 'llm-model' | 'prompt-template' | 'custom';
  config: any;
}

export interface ABTestExperiment {
  id: string;
  name: string;
  description: string;
  strategies: ABTestStrategy[];
  status: 'setup' | 'running' | 'completed' | 'failed';
  startTime?: Date;
  endTime?: Date;
  results?: ABTestResults;
}

export interface ABTestResults {
  winner?: string; // Strategy ID
  strategyResults: Map<string, StrategyResult>;
  statisticalSignificance: number;
  recommendation: string;
}

export interface StrategyResult {
  strategyId: string;
  strategyName: string;
  forkId?: string;
  metrics: {
    totalQueries: number;
    successRate: number;
    avgResponseTime: number;
    avgQueryCost: number;
    userSatisfaction?: number;
    errorRate: number;
  };
  samples: TestSample[];
}

export interface TestSample {
  query: string;
  result: any;
  success: boolean;
  responseTime: number;
  queryCost?: number;
  timestamp: Date;
}

export class ABTestingAgent {
  private mainPool: Pool;
  private forkManager: DatabaseForkManager;
  private experiments: Map<string, ABTestExperiment> = new Map();
  private strategyPools: Map<string, Pool> = new Map();

  constructor(mainPool: Pool, forkManager: DatabaseForkManager) {
    this.mainPool = mainPool;
    this.forkManager = forkManager;
  }

  /**
   * Create a new A/B test experiment
   */
  async createExperiment(
    name: string,
    description: string,
    strategies: ABTestStrategy[]
  ): Promise<ABTestExperiment> {
    logger.info({ name, strategyCount: strategies.length }, 'Creating A/B test experiment');

    if (strategies.length < 2) {
      throw new Error('At least 2 strategies required for A/B testing');
    }

    const experimentId = `experiment-${Date.now()}`;

    const experiment: ABTestExperiment = {
      id: experimentId,
      name,
      description,
      strategies,
      status: 'setup',
    };

    this.experiments.set(experimentId, experiment);

    // Store in database
    await this.storeExperiment(experiment);

    logger.info({ experimentId }, 'A/B test experiment created');

    return experiment;
  }

  /**
   * Start an A/B test experiment
   */
  async startExperiment(experimentId: string): Promise<void> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    logger.info({ experimentId }, 'Starting A/B test experiment');

    try {
      experiment.status = 'running';
      experiment.startTime = new Date();

      // Create forks for each strategy
      for (const strategy of experiment.strategies) {
        const fork = await this.forkManager.createFork({
          name: `abtest-${experimentId}-${strategy.id}`,
          strategy: 'now',
          waitForCompletion: true,
        });

        logger.info(
          { strategyId: strategy.id, forkId: fork.id },
          'Fork created for strategy'
        );

        // Get connection string and create pool
        const connectionString = await this.forkManager.getForkConnectionString(fork.id);
        const pool = new Pool({
          connectionString,
          max: 5,
        });

        this.strategyPools.set(strategy.id, pool);

        // Store fork info
        strategy.config.forkId = fork.id;
      }

      await this.updateExperiment(experiment);

      logger.info({ experimentId }, 'A/B test experiment started');
    } catch (error) {
      experiment.status = 'failed';
      logger.error({ error, experimentId }, 'Failed to start experiment');
      throw error;
    }
  }

  /**
   * Run test queries across all strategies
   */
  async runTest(
    experimentId: string,
    testQueries: string[]
  ): Promise<Map<string, StrategyResult>> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    if (experiment.status !== 'running') {
      throw new Error(`Experiment ${experimentId} is not running`);
    }

    logger.info(
      { experimentId, queryCount: testQueries.length },
      'Running A/B test queries'
    );

    const results = new Map<string, StrategyResult>();

    // Test each strategy
    for (const strategy of experiment.strategies) {
      const pool = this.strategyPools.get(strategy.id);
      if (!pool) {
        logger.warn({ strategyId: strategy.id }, 'Pool not found for strategy');
        continue;
      }

      const strategyResult: StrategyResult = {
        strategyId: strategy.id,
        strategyName: strategy.name,
        forkId: strategy.config.forkId,
        metrics: {
          totalQueries: 0,
          successRate: 0,
          avgResponseTime: 0,
          avgQueryCost: 0,
          errorRate: 0,
        },
        samples: [],
      };

      // Run all test queries
      for (const query of testQueries) {
        const sample = await this.runStrategyTest(strategy, pool, query);
        strategyResult.samples.push(sample);
      }

      // Calculate metrics
      strategyResult.metrics = this.calculateMetrics(strategyResult.samples);

      results.set(strategy.id, strategyResult);

      logger.info(
        {
          strategyId: strategy.id,
          successRate: strategyResult.metrics.successRate,
          avgResponseTime: strategyResult.metrics.avgResponseTime,
        },
        'Strategy test completed'
      );
    }

    return results;
  }

  /**
   * Run a single test for a strategy
   */
  private async runStrategyTest(
    strategy: ABTestStrategy,
    pool: Pool,
    query: string
  ): Promise<TestSample> {
    const startTime = Date.now();

    try {
      // Apply strategy-specific modifications
      const modifiedQuery = await this.applyStrategy(strategy, query);

      // Execute query
      const result = await pool.query(modifiedQuery);

      const responseTime = Date.now() - startTime;

      // Get query cost if possible
      let queryCost: number | undefined;
      try {
        const explainResult = await pool.query(`EXPLAIN (FORMAT JSON) ${modifiedQuery}`);
        queryCost = explainResult.rows[0]['QUERY PLAN'][0]['Plan']['Total Cost'];
      } catch (error) {
        // Ignore
      }

      return {
        query: modifiedQuery,
        result: result.rows,
        success: true,
        responseTime,
        queryCost,
        timestamp: new Date(),
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;

      logger.error(
        { error, strategyId: strategy.id, query },
        'Strategy test failed'
      );

      return {
        query,
        result: null,
        success: false,
        responseTime,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Apply strategy-specific modifications
   */
  private async applyStrategy(strategy: ABTestStrategy, query: string): Promise<string> {
    switch (strategy.type) {
      case 'sql-generation':
        // Different SQL generation approach
        return strategy.config.transform ? strategy.config.transform(query) : query;

      case 'optimization':
        // Apply optimization hints
        return `${strategy.config.hints || ''} ${query}`;

      case 'custom':
        // Custom strategy
        return strategy.config.apply ? await strategy.config.apply(query) : query;

      default:
        return query;
    }
  }

  /**
   * Calculate metrics from samples
   */
  private calculateMetrics(samples: TestSample[]): StrategyResult['metrics'] {
    const total = samples.length;
    const successful = samples.filter(s => s.success).length;

    const avgResponseTime =
      samples.reduce((sum, s) => sum + s.responseTime, 0) / total;

    const queryCosts = samples.filter(s => s.queryCost !== undefined).map(s => s.queryCost!);
    const avgQueryCost =
      queryCosts.length > 0
        ? queryCosts.reduce((sum, c) => sum + c, 0) / queryCosts.length
        : 0;

    return {
      totalQueries: total,
      successRate: (successful / total) * 100,
      avgResponseTime,
      avgQueryCost,
      errorRate: ((total - successful) / total) * 100,
    };
  }

  /**
   * Analyze experiment results and determine winner
   */
  async analyzeResults(experimentId: string): Promise<ABTestResults> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    logger.info({ experimentId }, 'Analyzing A/B test results');

    // Get results from database
    const resultsData = await this.loadExperimentResults(experimentId);

    // Determine winner based on multiple criteria
    const winner = this.determineWinner(resultsData);

    // Calculate statistical significance
    const significance = this.calculateSignificance(resultsData);

    // Generate recommendation
    const recommendation = this.generateRecommendation(resultsData, winner, significance);

    const results: ABTestResults = {
      winner: winner?.strategyId,
      strategyResults: resultsData,
      statisticalSignificance: significance,
      recommendation,
    };

    experiment.results = results;
    experiment.status = 'completed';
    experiment.endTime = new Date();

    await this.updateExperiment(experiment);

    logger.info(
      { experimentId, winner: winner?.strategyName, significance },
      'A/B test analysis completed'
    );

    return results;
  }

  /**
   * Determine winning strategy
   */
  private determineWinner(results: Map<string, StrategyResult>): StrategyResult | null {
    if (results.size === 0) return null;

    const strategies = Array.from(results.values());

    // Score each strategy based on multiple factors
    const scores = strategies.map(strategy => {
      const successWeight = 0.4;
      const speedWeight = 0.3;
      const costWeight = 0.3;

      // Normalize metrics (0-1 scale)
      const maxResponseTime = Math.max(...strategies.map(s => s.metrics.avgResponseTime));
      const maxQueryCost = Math.max(...strategies.map(s => s.metrics.avgQueryCost));

      const successScore = strategy.metrics.successRate / 100;
      const speedScore = 1 - (strategy.metrics.avgResponseTime / maxResponseTime);
      const costScore = maxQueryCost > 0 ? 1 - (strategy.metrics.avgQueryCost / maxQueryCost) : 1;

      const totalScore =
        successWeight * successScore +
        speedWeight * speedScore +
        costWeight * costScore;

      return { strategy, score: totalScore };
    });

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    return scores[0].strategy;
  }

  /**
   * Calculate statistical significance
   */
  private calculateSignificance(results: Map<string, StrategyResult>): number {
    // Simplified significance calculation
    // In production, would use proper statistical tests (t-test, chi-square, etc.)

    const strategies = Array.from(results.values());
    if (strategies.length < 2) return 0;

    const sampleSizes = strategies.map(s => s.metrics.totalQueries);
    const minSampleSize = Math.min(...sampleSizes);

    // Basic heuristic: confidence increases with sample size
    if (minSampleSize < 10) return 0.5;
    if (minSampleSize < 30) return 0.7;
    if (minSampleSize < 100) return 0.85;
    return 0.95;
  }

  /**
   * Generate recommendation
   */
  private generateRecommendation(
    results: Map<string, StrategyResult>,
    winner: StrategyResult | null,
    significance: number
  ): string {
    if (!winner) {
      return 'No clear winner. More testing required.';
    }

    const strategies = Array.from(results.values());
    const winnerMetrics = winner.metrics;

    let recommendation = `**Recommended Strategy: ${winner.strategyName}**\n\n`;

    recommendation += `Performance Highlights:\n`;
    recommendation += `- Success Rate: ${winnerMetrics.successRate.toFixed(1)}%\n`;
    recommendation += `- Avg Response Time: ${winnerMetrics.avgResponseTime.toFixed(0)}ms\n`;
    recommendation += `- Avg Query Cost: ${winnerMetrics.avgQueryCost.toFixed(2)}\n\n`;

    if (significance < 0.8) {
      recommendation += `⚠️ Statistical confidence is ${(significance * 100).toFixed(0)}%. Consider running more tests.\n\n`;
    } else {
      recommendation += `✅ High statistical confidence (${(significance * 100).toFixed(0)}%).\n\n`;
    }

    // Compare to other strategies
    const others = strategies.filter(s => s.strategyId !== winner.strategyId);
    if (others.length > 0) {
      recommendation += `Compared to alternatives:\n`;
      for (const other of others) {
        const speedupPercent = (
          ((other.metrics.avgResponseTime - winnerMetrics.avgResponseTime) /
            other.metrics.avgResponseTime) *
          100
        ).toFixed(1);

        recommendation += `- ${speedupPercent}% faster than ${other.strategyName}\n`;
      }
    }

    return recommendation;
  }

  /**
   * Stop an experiment and cleanup
   */
  async stopExperiment(experimentId: string, deleteForks: boolean = false): Promise<void> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    logger.info({ experimentId, deleteForks }, 'Stopping A/B test experiment');

    // Close all strategy pools
    for (const [strategyId, pool] of this.strategyPools.entries()) {
      await pool.end();
      this.strategyPools.delete(strategyId);
    }

    // Delete forks if requested
    if (deleteForks) {
      for (const strategy of experiment.strategies) {
        if (strategy.config.forkId) {
          try {
            await this.forkManager.deleteFork(strategy.config.forkId);
          } catch (error) {
            logger.error({ error, forkId: strategy.config.forkId }, 'Failed to delete fork');
          }
        }
      }
    }

    experiment.status = 'completed';
    experiment.endTime = new Date();

    await this.updateExperiment(experiment);

    logger.info({ experimentId }, 'A/B test experiment stopped');
  }

  /**
   * Store experiment in database
   */
  private async storeExperiment(experiment: ABTestExperiment): Promise<void> {
    await this.mainPool.query(`
      CREATE TABLE IF NOT EXISTS neurobase_ab_experiments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        strategies JSONB,
        status TEXT,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        results JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await this.mainPool.query(
      `INSERT INTO neurobase_ab_experiments (id, name, description, strategies, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status`,
      [
        experiment.id,
        experiment.name,
        experiment.description,
        JSON.stringify(experiment.strategies),
        experiment.status,
      ]
    );
  }

  /**
   * Update experiment in database
   */
  private async updateExperiment(experiment: ABTestExperiment): Promise<void> {
    await this.mainPool.query(
      `UPDATE neurobase_ab_experiments
       SET status = $1, start_time = $2, end_time = $3, results = $4
       WHERE id = $5`,
      [
        experiment.status,
        experiment.startTime,
        experiment.endTime,
        experiment.results ? JSON.stringify(experiment.results) : null,
        experiment.id,
      ]
    );
  }

  /**
   * Load experiment results from database
   */
  private async loadExperimentResults(experimentId: string): Promise<Map<string, StrategyResult>> {
    // This would load actual results from database
    // For now, return from memory
    const results = new Map<string, StrategyResult>();
    // Implementation depends on how results are stored
    return results;
  }

  /**
   * Get experiment by ID
   */
  getExperiment(experimentId: string): ABTestExperiment | undefined {
    return this.experiments.get(experimentId);
  }

  /**
   * Get all experiments
   */
  getAllExperiments(): ABTestExperiment[] {
    return Array.from(this.experiments.values());
  }

  /**
   * Get statistics
   */
  getStatistics(): any {
    const experiments = Array.from(this.experiments.values());

    return {
      totalExperiments: experiments.length,
      runningExperiments: experiments.filter(e => e.status === 'running').length,
      completedExperiments: experiments.filter(e => e.status === 'completed').length,
      activeForks: this.strategyPools.size,
    };
  }
}
