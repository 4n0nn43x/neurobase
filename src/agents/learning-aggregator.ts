/**
 * Learning Aggregator Agent
 * Collects and synthesizes learning from all agents
 * Identifies cross-agent patterns and synchronizes knowledge
 */

import { Pool } from 'pg';
import { logger } from '../utils/logger';
import { EmbeddingService } from '../utils/embeddings';

export interface LearningInsight {
  id: string;
  type: 'pattern' | 'optimization' | 'error' | 'correction' | 'cross-agent';
  description: string;
  confidence: number;
  sources: string[]; // Agent IDs that contributed
  impact: 'high' | 'medium' | 'low';
  actionable: boolean;
  relatedQueries: string[];
  timestamp: Date;
  metadata?: any;
}

export interface AgentLearning {
  agentId: string;
  agentType: string;
  learningCount: number;
  successRate: number;
  recentInsights: LearningInsight[];
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface KnowledgeNode {
  id: string;
  type: 'query' | 'table' | 'pattern' | 'optimization';
  label: string;
  weight: number;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  relationship: string;
  weight: number;
}

export class LearningAggregatorAgent {
  private pool: Pool;
  private embeddingService: EmbeddingService;
  private aggregationInterval?: NodeJS.Timeout;
  private insightCache: Map<string, LearningInsight> = new Map();

  constructor(pool: Pool) {
    this.pool = pool;
    this.embeddingService = EmbeddingService.getInstance();
  }

  /**
   * Start continuous learning aggregation
   */
  startAggregation(intervalMs: number = 1800000): void {
    logger.info({ intervalMs }, 'Starting learning aggregation');

    this.aggregationInterval = setInterval(async () => {
      try {
        await this.aggregateAndSynthesize();
      } catch (error) {
        logger.error({ error }, 'Error during learning aggregation');
      }
    }, intervalMs);
  }

  /**
   * Stop aggregation
   */
  stopAggregation(): void {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = undefined;
      logger.info('Learning aggregation stopped');
    }
  }

  /**
   * Aggregate and synthesize learning from all agents
   */
  async aggregateAndSynthesize(): Promise<LearningInsight[]> {
    logger.info('Starting learning aggregation and synthesis');

    const startTime = Date.now();

    // Collect learning from all agents
    const agentLearnings = await this.collectAgentLearnings();

    // Identify cross-agent patterns
    const crossAgentPatterns = await this.identifyCrossAgentPatterns(agentLearnings);

    // Generate insights
    const insights = await this.generateInsights(agentLearnings, crossAgentPatterns);

    // Store insights
    await this.storeInsights(insights);

    // Update knowledge graph
    await this.updateKnowledgeGraph(insights);

    const aggregationTime = Date.now() - startTime;

    logger.info(
      { insightCount: insights.length, aggregationTime },
      'Learning aggregation completed'
    );

    return insights;
  }

  /**
   * Collect learning data from all agents
   */
  private async collectAgentLearnings(): Promise<AgentLearning[]> {
    const learnings: AgentLearning[] = [];

    // Get all registered agents
    const agentsResult = await this.pool.query(
      `SELECT id, name, type, metrics FROM neurobase_agents WHERE status = 'running'`
    );

    for (const agent of agentsResult.rows) {
      // Get learning history for this agent
      const historyResult = await this.pool.query(
        `SELECT COUNT(*) as total, SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful
         FROM neurobase_learning_history
         WHERE user_id = $1 AND timestamp > NOW() - INTERVAL '24 hours'`,
        [agent.id]
      );

      const stats = historyResult.rows[0];
      const total = parseInt(stats.total) || 0;
      const successful = parseInt(stats.successful) || 0;

      learnings.push({
        agentId: agent.id,
        agentType: agent.type,
        learningCount: total,
        successRate: total > 0 ? (successful / total) * 100 : 0,
        recentInsights: [], // Will be populated later
      });
    }

    return learnings;
  }

  /**
   * Identify patterns that span multiple agents
   */
  private async identifyCrossAgentPatterns(learnings: AgentLearning[]): Promise<any[]> {
    const patterns: any[] = [];

    // Get recent queries from all agents
    const queriesResult = await this.pool.query(
      `SELECT natural_language, sql, user_id as agent_id, embedding
       FROM neurobase_learning_history
       WHERE timestamp > NOW() - INTERVAL '7 days'
       AND success = TRUE
       ORDER BY timestamp DESC
       LIMIT 500`
    );

    // Group queries by similarity
    const queryClusters = await this.clusterSimilarQueries(queriesResult.rows);

    // Identify clusters that span multiple agents
    for (const cluster of queryClusters) {
      const uniqueAgents = new Set(cluster.queries.map((q: any) => q.agent_id));

      if (uniqueAgents.size > 1) {
        // This pattern appears across multiple agents
        patterns.push({
          pattern: cluster.centroid,
          agents: Array.from(uniqueAgents),
          frequency: cluster.queries.length,
          queries: cluster.queries,
        });
      }
    }

    return patterns;
  }

  /**
   * Cluster similar queries using embeddings
   */
  private async clusterSimilarQueries(queries: any[]): Promise<any[]> {
    const clusters: any[] = [];
    const processed = new Set<number>();

    const similarityThreshold = 0.85;

    for (let i = 0; i < queries.length; i++) {
      if (processed.has(i)) continue;

      const cluster = {
        centroid: queries[i].natural_language,
        queries: [queries[i]],
      };

      // Find similar queries
      for (let j = i + 1; j < queries.length; j++) {
        if (processed.has(j)) continue;

        // Calculate similarity using embeddings
        const similarity = await this.calculateSimilarity(
          queries[i].natural_language,
          queries[j].natural_language
        );

        if (similarity > similarityThreshold) {
          cluster.queries.push(queries[j]);
          processed.add(j);
        }
      }

      processed.add(i);
      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * Calculate similarity between two texts
   */
  private async calculateSimilarity(text1: string, text2: string): Promise<number> {
    const embedding1 = await this.embeddingService.generateEmbedding(text1);
    const embedding2 = await this.embeddingService.generateEmbedding(text2);

    return this.embeddingService.cosineSimilarity(embedding1, embedding2);
  }

  /**
   * Generate insights from aggregated learning
   */
  private async generateInsights(
    learnings: AgentLearning[],
    patterns: any[]
  ): Promise<LearningInsight[]> {
    const insights: LearningInsight[] = [];

    // Generate insights from cross-agent patterns
    for (const pattern of patterns) {
      const insight: LearningInsight = {
        id: `insight-${Date.now()}-${Math.random()}`,
        type: 'cross-agent',
        description: `Pattern "${pattern.pattern}" observed across ${pattern.agents.length} agents`,
        confidence: Math.min(pattern.frequency / 10, 1.0),
        sources: pattern.agents,
        impact: pattern.frequency > 10 ? 'high' : pattern.frequency > 5 ? 'medium' : 'low',
        actionable: true,
        relatedQueries: pattern.queries.map((q: any) => q.natural_language).slice(0, 5),
        timestamp: new Date(),
        metadata: {
          frequency: pattern.frequency,
          sampleSQL: pattern.queries[0]?.sql,
        },
      };

      insights.push(insight);
      this.insightCache.set(insight.id, insight);
    }

    // Generate insights from individual agent performance
    for (const learning of learnings) {
      if (learning.successRate < 70) {
        insights.push({
          id: `insight-${Date.now()}-${Math.random()}`,
          type: 'error',
          description: `Agent ${learning.agentId} has low success rate: ${learning.successRate.toFixed(1)}%`,
          confidence: 0.9,
          sources: [learning.agentId],
          impact: 'high',
          actionable: true,
          relatedQueries: [],
          timestamp: new Date(),
        });
      }

      if (learning.learningCount > 100) {
        insights.push({
          id: `insight-${Date.now()}-${Math.random()}`,
          type: 'pattern',
          description: `Agent ${learning.agentId} processing high volume: ${learning.learningCount} queries`,
          confidence: 1.0,
          sources: [learning.agentId],
          impact: 'medium',
          actionable: false,
          relatedQueries: [],
          timestamp: new Date(),
        });
      }
    }

    // Identify optimization opportunities
    const optimizationInsights = await this.identifyOptimizationOpportunities();
    insights.push(...optimizationInsights);

    return insights;
  }

  /**
   * Identify optimization opportunities
   */
  private async identifyOptimizationOpportunities(): Promise<LearningInsight[]> {
    const insights: LearningInsight[] = [];

    // Find frequently corrected queries
    const correctionsResult = await this.pool.query(
      `SELECT original_query, COUNT(*) as correction_count
       FROM neurobase_corrections
       WHERE timestamp > NOW() - INTERVAL '7 days'
       GROUP BY original_query
       HAVING COUNT(*) > 2
       ORDER BY correction_count DESC
       LIMIT 10`
    );

    for (const row of correctionsResult.rows) {
      insights.push({
        id: `insight-opt-${Date.now()}-${Math.random()}`,
        type: 'correction',
        description: `Query "${row.original_query}" frequently corrected (${row.correction_count} times)`,
        confidence: 0.95,
        sources: ['user-corrections'],
        impact: 'high',
        actionable: true,
        relatedQueries: [row.original_query],
        timestamp: new Date(),
        metadata: {
          correctionCount: parseInt(row.correction_count),
        },
      });
    }

    return insights;
  }

  /**
   * Store insights in database
   */
  private async storeInsights(insights: LearningInsight[]): Promise<void> {
    // Create insights table if not exists
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS neurobase_insights (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        confidence NUMERIC,
        sources JSONB,
        impact TEXT,
        actionable BOOLEAN,
        related_queries JSONB,
        metadata JSONB,
        timestamp TIMESTAMP DEFAULT NOW()
      );
    `);

    // Insert insights
    for (const insight of insights) {
      await this.pool.query(
        `INSERT INTO neurobase_insights
         (id, type, description, confidence, sources, impact, actionable, related_queries, metadata, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
         confidence = EXCLUDED.confidence,
         timestamp = EXCLUDED.timestamp`,
        [
          insight.id,
          insight.type,
          insight.description,
          insight.confidence,
          JSON.stringify(insight.sources),
          insight.impact,
          insight.actionable,
          JSON.stringify(insight.relatedQueries),
          JSON.stringify(insight.metadata || {}),
          insight.timestamp,
        ]
      );
    }

    logger.info({ count: insights.length }, 'Insights stored in database');
  }

  /**
   * Update knowledge graph based on new insights
   */
  private async updateKnowledgeGraph(insights: LearningInsight[]): Promise<void> {
    // Create knowledge graph tables if not exists
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS neurobase_knowledge_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        weight NUMERIC DEFAULT 1.0,
        metadata JSONB,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS neurobase_knowledge_edges (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        from_node TEXT REFERENCES neurobase_knowledge_nodes(id),
        to_node TEXT REFERENCES neurobase_knowledge_nodes(id),
        relationship TEXT NOT NULL,
        weight NUMERIC DEFAULT 1.0,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Update graph based on insights
    for (const insight of insights) {
      // Create nodes for related queries
      for (const query of insight.relatedQueries.slice(0, 3)) {
        const nodeId = `query-${Buffer.from(query).toString('base64').substring(0, 20)}`;

        await this.pool.query(
          `INSERT INTO neurobase_knowledge_nodes (id, type, label, weight)
           VALUES ($1, 'query', $2, $3)
           ON CONFLICT (id) DO UPDATE SET
           weight = neurobase_knowledge_nodes.weight + 1,
           updated_at = NOW()`,
          [nodeId, query.substring(0, 100), insight.confidence]
        );
      }
    }

    logger.debug('Knowledge graph updated');
  }

  /**
   * Get knowledge graph
   */
  async getKnowledgeGraph(limit: number = 100): Promise<KnowledgeGraph> {
    const nodesResult = await this.pool.query(
      `SELECT * FROM neurobase_knowledge_nodes ORDER BY weight DESC LIMIT $1`,
      [limit]
    );

    const edgesResult = await this.pool.query(
      `SELECT * FROM neurobase_knowledge_edges ORDER BY weight DESC LIMIT $1`,
      [limit]
    );

    return {
      nodes: nodesResult.rows.map(row => ({
        id: row.id,
        type: row.type,
        label: row.label,
        weight: parseFloat(row.weight),
      })),
      edges: edgesResult.rows.map(row => ({
        from: row.from_node,
        to: row.to_node,
        relationship: row.relationship,
        weight: parseFloat(row.weight),
      })),
    };
  }

  /**
   * Get recent insights
   */
  async getInsights(filter?: {
    type?: string;
    impact?: string;
    actionable?: boolean;
    limit?: number;
  }): Promise<LearningInsight[]> {
    let query = 'SELECT * FROM neurobase_insights WHERE 1=1';
    const params: any[] = [];
    let paramCount = 1;

    if (filter?.type) {
      query += ` AND type = $${paramCount++}`;
      params.push(filter.type);
    }

    if (filter?.impact) {
      query += ` AND impact = $${paramCount++}`;
      params.push(filter.impact);
    }

    if (filter?.actionable !== undefined) {
      query += ` AND actionable = $${paramCount++}`;
      params.push(filter.actionable);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramCount}`;
    params.push(filter?.limit || 50);

    const result = await this.pool.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      description: row.description,
      confidence: parseFloat(row.confidence),
      sources: row.sources,
      impact: row.impact,
      actionable: row.actionable,
      relatedQueries: row.related_queries,
      timestamp: row.timestamp,
      metadata: row.metadata,
    }));
  }

  /**
   * Get aggregation statistics
   */
  async getStatistics(): Promise<any> {
    const insightsResult = await this.pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actionable = TRUE) as actionable,
        COUNT(*) FILTER (WHERE impact = 'high') as high_impact,
        COUNT(*) FILTER (WHERE type = 'cross-agent') as cross_agent
       FROM neurobase_insights
       WHERE timestamp > NOW() - INTERVAL '7 days'`
    );

    const stats = insightsResult.rows[0];

    const graphResult = await this.pool.query(
      `SELECT COUNT(*) as nodes FROM neurobase_knowledge_nodes`
    );

    return {
      totalInsights: parseInt(stats.total) || 0,
      actionableInsights: parseInt(stats.actionable) || 0,
      highImpactInsights: parseInt(stats.high_impact) || 0,
      crossAgentPatterns: parseInt(stats.cross_agent) || 0,
      knowledgeGraphNodes: parseInt(graphResult.rows[0]?.nodes) || 0,
      cachedInsights: this.insightCache.size,
    };
  }
}
