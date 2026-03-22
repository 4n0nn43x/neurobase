/**
 * A/B Testing Agent
 * Tests different strategies in parallel using database adapter
 * Compares approaches and recommends best performing strategy
 */

import { Pool } from 'pg';
import { logger } from '../utils/logger';

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
  winner?: string;
  strategyResults: Map<string, StrategyResult>;
  statisticalSignificance: number;
  recommendation: string;
}

export interface StrategyResult {
  strategyId: string;
  strategyName: string;
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
  private experiments: Map<string, ABTestExperiment> = new Map();

  constructor(mainPool: Pool) {
    this.mainPool = mainPool;
  }

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
    await this.storeExperiment(experiment);

    return experiment;
  }

  async startExperiment(experimentId: string): Promise<void> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    experiment.status = 'running';
    experiment.startTime = new Date();
    await this.updateExperiment(experiment);

    logger.info({ experimentId }, 'A/B test experiment started');
  }

  async runTest(
    experimentId: string,
    testQueries: string[]
  ): Promise<Map<string, StrategyResult>> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);
    if (experiment.status !== 'running') throw new Error(`Experiment ${experimentId} is not running`);

    const results = new Map<string, StrategyResult>();

    for (const strategy of experiment.strategies) {
      const strategyResult: StrategyResult = {
        strategyId: strategy.id,
        strategyName: strategy.name,
        metrics: {
          totalQueries: 0,
          successRate: 0,
          avgResponseTime: 0,
          avgQueryCost: 0,
          errorRate: 0,
        },
        samples: [],
      };

      for (const query of testQueries) {
        const sample = await this.runStrategyTest(strategy, query);
        strategyResult.samples.push(sample);
      }

      strategyResult.metrics = this.calculateMetrics(strategyResult.samples);
      results.set(strategy.id, strategyResult);
    }

    return results;
  }

  private async runStrategyTest(strategy: ABTestStrategy, query: string): Promise<TestSample> {
    const startTime = Date.now();

    try {
      const modifiedQuery = await this.applyStrategy(strategy, query);
      const result = await this.mainPool.query(modifiedQuery);
      const responseTime = Date.now() - startTime;

      let queryCost: number | undefined;
      try {
        const explainResult = await this.mainPool.query(`EXPLAIN (FORMAT JSON) ${modifiedQuery}`);
        queryCost = explainResult.rows[0]['QUERY PLAN'][0]['Plan']['Total Cost'];
      } catch {
        // Ignore
      }

      return { query: modifiedQuery, result: result.rows, success: true, responseTime, queryCost, timestamp: new Date() };
    } catch (error: any) {
      return { query, result: null, success: false, responseTime: Date.now() - startTime, timestamp: new Date() };
    }
  }

  private async applyStrategy(strategy: ABTestStrategy, query: string): Promise<string> {
    switch (strategy.type) {
      case 'sql-generation':
        return strategy.config.transform ? strategy.config.transform(query) : query;
      case 'optimization':
        return `${strategy.config.hints || ''} ${query}`;
      case 'custom':
        return strategy.config.apply ? await strategy.config.apply(query) : query;
      default:
        return query;
    }
  }

  private calculateMetrics(samples: TestSample[]): StrategyResult['metrics'] {
    const total = samples.length;
    const successful = samples.filter(s => s.success).length;
    const avgResponseTime = samples.reduce((sum, s) => sum + s.responseTime, 0) / total;
    const queryCosts = samples.filter(s => s.queryCost !== undefined).map(s => s.queryCost!);
    const avgQueryCost = queryCosts.length > 0 ? queryCosts.reduce((sum, c) => sum + c, 0) / queryCosts.length : 0;

    return {
      totalQueries: total,
      successRate: (successful / total) * 100,
      avgResponseTime,
      avgQueryCost,
      errorRate: ((total - successful) / total) * 100,
    };
  }

  async analyzeResults(experimentId: string): Promise<ABTestResults> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    const resultsData = new Map<string, StrategyResult>();
    const winner = this.determineWinner(resultsData);
    const significance = this.calculateSignificance(resultsData);
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

    return results;
  }

  private determineWinner(results: Map<string, StrategyResult>): StrategyResult | null {
    if (results.size === 0) return null;
    const strategies = Array.from(results.values());
    const maxRT = Math.max(...strategies.map(s => s.metrics.avgResponseTime));
    const maxCost = Math.max(...strategies.map(s => s.metrics.avgQueryCost));

    const scores = strategies.map(s => ({
      strategy: s,
      score: 0.4 * (s.metrics.successRate / 100) +
             0.3 * (1 - s.metrics.avgResponseTime / (maxRT || 1)) +
             0.3 * (maxCost > 0 ? 1 - s.metrics.avgQueryCost / maxCost : 1),
    }));
    scores.sort((a, b) => b.score - a.score);
    return scores[0].strategy;
  }

  private calculateSignificance(results: Map<string, StrategyResult>): number {
    const strategies = Array.from(results.values());
    if (strategies.length < 2) return 0;
    const minSamples = Math.min(...strategies.map(s => s.metrics.totalQueries));
    if (minSamples < 10) return 0.5;
    if (minSamples < 30) return 0.7;
    if (minSamples < 100) return 0.85;
    return 0.95;
  }

  private generateRecommendation(
    _results: Map<string, StrategyResult>,
    winner: StrategyResult | null,
    significance: number
  ): string {
    if (!winner) return 'No clear winner. More testing required.';
    let rec = `Recommended: ${winner.strategyName} (${(significance * 100).toFixed(0)}% confidence)\n`;
    rec += `Success: ${winner.metrics.successRate.toFixed(1)}%, Avg RT: ${winner.metrics.avgResponseTime.toFixed(0)}ms`;
    return rec;
  }

  async stopExperiment(experimentId: string): Promise<void> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);
    experiment.status = 'completed';
    experiment.endTime = new Date();
    await this.updateExperiment(experiment);
  }

  private async storeExperiment(experiment: ABTestExperiment): Promise<void> {
    await this.mainPool.query(`
      CREATE TABLE IF NOT EXISTS neurobase_ab_experiments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
        strategies JSONB, status TEXT, start_time TIMESTAMP, end_time TIMESTAMP,
        results JSONB, created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await this.mainPool.query(
      `INSERT INTO neurobase_ab_experiments (id, name, description, strategies, status)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [experiment.id, experiment.name, experiment.description, JSON.stringify(experiment.strategies), experiment.status]
    );
  }

  private async updateExperiment(experiment: ABTestExperiment): Promise<void> {
    await this.mainPool.query(
      `UPDATE neurobase_ab_experiments SET status = $1, start_time = $2, end_time = $3, results = $4 WHERE id = $5`,
      [experiment.status, experiment.startTime, experiment.endTime, experiment.results ? JSON.stringify(experiment.results) : null, experiment.id]
    );
  }

  getExperiment(experimentId: string): ABTestExperiment | undefined {
    return this.experiments.get(experimentId);
  }

  getAllExperiments(): ABTestExperiment[] {
    return Array.from(this.experiments.values());
  }

  getStatistics(): any {
    const experiments = Array.from(this.experiments.values());
    return {
      totalExperiments: experiments.length,
      runningExperiments: experiments.filter(e => e.status === 'running').length,
      completedExperiments: experiments.filter(e => e.status === 'completed').length,
    };
  }
}
