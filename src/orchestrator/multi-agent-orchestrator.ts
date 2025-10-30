/**
 * Multi-Agent Orchestrator
 * Manages multiple specialized agents working in parallel on separate database forks
 */

import { DatabaseForkManager, ForkInfo } from '../database/fork';
import { logger } from '../utils/logger';
import { Pool } from 'pg';
import { EventEmitter } from 'events';

export interface AgentConfig {
  name: string;
  type: 'schema-evolution' | 'query-validator' | 'learning-aggregator' | 'ab-testing' | 'custom';
  enabled: boolean;
  forkStrategy: 'now' | 'last-snapshot' | 'to-timestamp';
  cpu?: string;
  memory?: string;
  autoStart?: boolean;
}

export interface AgentInstance {
  id: string;
  config: AgentConfig;
  fork?: ForkInfo;
  pool?: Pool;
  status: 'initializing' | 'running' | 'idle' | 'error' | 'stopped';
  lastActivity?: Date;
  metrics: {
    tasksProcessed: number;
    errors: number;
    avgProcessingTime: number;
    startTime: Date;
  };
}

export interface OrchestratorEvent {
  type: 'agent:started' | 'agent:stopped' | 'agent:error' | 'task:completed' | 'fork:created' | 'sync:started' | 'sync:completed';
  timestamp: Date;
  agentId?: string;
  data?: any;
}

export class MultiAgentOrchestrator extends EventEmitter {
  private forkManager: DatabaseForkManager;
  private agents: Map<string, AgentInstance>;
  private mainPool: Pool;
  private isInitialized: boolean = false;
  private eventHistory: OrchestratorEvent[] = [];
  private maxEventHistory: number = 1000;

  constructor(mainConnectionString: string, serviceId?: string) {
    super();
    this.forkManager = new DatabaseForkManager(serviceId);
    this.agents = new Map();
    this.mainPool = new Pool({
      connectionString: mainConnectionString,
      max: 10,
    });

    // Setup event logging
    this.setupEventLogging();
  }

  /**
   * Setup internal event logging
   */
  private setupEventLogging(): void {
    this.on('agent:started', (event) => this.logEvent(event));
    this.on('agent:stopped', (event) => this.logEvent(event));
    this.on('agent:error', (event) => this.logEvent(event));
    this.on('task:completed', (event) => this.logEvent(event));
    this.on('fork:created', (event) => this.logEvent(event));
    this.on('sync:started', (event) => this.logEvent(event));
    this.on('sync:completed', (event) => this.logEvent(event));
  }

  /**
   * Log orchestrator events
   */
  private logEvent(event: OrchestratorEvent): void {
    this.eventHistory.push(event);

    // Keep only last N events
    if (this.eventHistory.length > this.maxEventHistory) {
      this.eventHistory.shift();
    }

    logger.info({ event }, 'Orchestrator event');
  }

  /**
   * Initialize the orchestrator and database tables
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Orchestrator already initialized');
      return;
    }

    logger.info('Initializing Multi-Agent Orchestrator');

    try {
      // Create orchestrator tables in main database
      await this.createOrchestratorTables();

      this.isInitialized = true;
      logger.info('Multi-Agent Orchestrator initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize orchestrator');
      throw error;
    }
  }

  /**
   * Create orchestrator tracking tables
   */
  private async createOrchestratorTables(): Promise<void> {
    const createTablesSQL = `
      -- Agent registry table
      CREATE TABLE IF NOT EXISTS neurobase_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        fork_id TEXT,
        status TEXT NOT NULL,
        config JSONB,
        metrics JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Agent tasks queue
      CREATE TABLE IF NOT EXISTS neurobase_agent_tasks (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        agent_id TEXT REFERENCES neurobase_agents(id),
        task_type TEXT NOT NULL,
        payload JSONB,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER DEFAULT 5,
        result JSONB,
        error TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        started_at TIMESTAMP,
        completed_at TIMESTAMP
      );

      -- Agent communication/synchronization table
      CREATE TABLE IF NOT EXISTS neurobase_agent_messages (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        from_agent_id TEXT,
        to_agent_id TEXT,
        message_type TEXT NOT NULL,
        payload JSONB,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Agent metrics history
      CREATE TABLE IF NOT EXISTS neurobase_agent_metrics (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        agent_id TEXT REFERENCES neurobase_agents(id),
        metric_name TEXT NOT NULL,
        metric_value NUMERIC,
        metadata JSONB,
        timestamp TIMESTAMP DEFAULT NOW()
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON neurobase_agent_tasks(status, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent_id ON neurobase_agent_tasks(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON neurobase_agent_messages(to_agent_id, read);
      CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_time ON neurobase_agent_metrics(agent_id, timestamp DESC);
    `;

    await this.mainPool.query(createTablesSQL);
    logger.info('Orchestrator tables created successfully');
  }

  /**
   * Register a new agent
   */
  async registerAgent(config: AgentConfig): Promise<AgentInstance> {
    logger.info({ config }, 'Registering new agent');

    const agentId = `agent-${config.type}-${Date.now()}`;

    const agent: AgentInstance = {
      id: agentId,
      config,
      status: 'initializing',
      metrics: {
        tasksProcessed: 0,
        errors: 0,
        avgProcessingTime: 0,
        startTime: new Date(),
      },
    };

    this.agents.set(agentId, agent);

    // Store in database
    await this.mainPool.query(
      `INSERT INTO neurobase_agents (id, name, type, status, config, metrics)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [agentId, config.name, config.type, agent.status, JSON.stringify(config), JSON.stringify(agent.metrics)]
    );

    // Create dedicated fork for this agent if enabled
    if (config.enabled) {
      await this.startAgent(agentId);
    }

    return agent;
  }

  /**
   * Start an agent (create fork and initialize)
   */
  async startAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    logger.info({ agentId, agentType: agent.config.type }, 'Starting agent');

    try {
      // Create database fork for this agent
      const fork = await this.forkManager.createFork({
        name: `${agent.config.name}-fork`,
        strategy: agent.config.forkStrategy,
        cpu: agent.config.cpu,
        memory: agent.config.memory,
        waitForCompletion: true,
      });

      agent.fork = fork;

      // Get connection string for the fork
      const forkConnectionString = await this.forkManager.getForkConnectionString(fork.id);

      // Create connection pool for this agent's fork
      agent.pool = new Pool({
        connectionString: forkConnectionString,
        max: 5,
      });

      // Update status
      agent.status = 'running';
      agent.lastActivity = new Date();

      // Update database
      await this.mainPool.query(
        `UPDATE neurobase_agents
         SET status = $1, fork_id = $2, updated_at = NOW()
         WHERE id = $3`,
        [agent.status, fork.id, agentId]
      );

      this.emit('agent:started', {
        type: 'agent:started',
        timestamp: new Date(),
        agentId,
        data: { fork },
      } as OrchestratorEvent);

      this.emit('fork:created', {
        type: 'fork:created',
        timestamp: new Date(),
        agentId,
        data: fork,
      } as OrchestratorEvent);

      logger.info({ agentId, forkId: fork.id }, 'Agent started successfully');
    } catch (error) {
      agent.status = 'error';
      this.emit('agent:error', {
        type: 'agent:error',
        timestamp: new Date(),
        agentId,
        data: { error: String(error) },
      } as OrchestratorEvent);
      logger.error({ error, agentId }, 'Failed to start agent');
      throw error;
    }
  }

  /**
   * Stop an agent (cleanup fork and connections)
   */
  async stopAgent(agentId: string, deleteFork: boolean = false): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    logger.info({ agentId, deleteFork }, 'Stopping agent');

    try {
      // Close connection pool
      if (agent.pool) {
        await agent.pool.end();
        agent.pool = undefined;
      }

      // Delete fork if requested
      if (deleteFork && agent.fork) {
        await this.forkManager.deleteFork(agent.fork.id);
      }

      agent.status = 'stopped';

      await this.mainPool.query(
        `UPDATE neurobase_agents SET status = $1, updated_at = NOW() WHERE id = $2`,
        [agent.status, agentId]
      );

      this.emit('agent:stopped', {
        type: 'agent:stopped',
        timestamp: new Date(),
        agentId,
      } as OrchestratorEvent);

      logger.info({ agentId }, 'Agent stopped successfully');
    } catch (error) {
      logger.error({ error, agentId }, 'Failed to stop agent');
      throw error;
    }
  }

  /**
   * Submit a task to an agent
   */
  async submitTask(agentId: string, taskType: string, payload: any, priority: number = 5): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.status !== 'running') {
      throw new Error(`Agent ${agentId} is not running (status: ${agent.status})`);
    }

    const result = await this.mainPool.query(
      `INSERT INTO neurobase_agent_tasks (agent_id, task_type, payload, priority)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [agentId, taskType, JSON.stringify(payload), priority]
    );

    const taskId = result.rows[0].id;
    logger.info({ agentId, taskId, taskType }, 'Task submitted to agent');

    return taskId;
  }

  /**
   * Get task status
   */
  async getTaskStatus(taskId: string): Promise<any> {
    const result = await this.mainPool.query(
      `SELECT * FROM neurobase_agent_tasks WHERE id = $1`,
      [taskId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Task ${taskId} not found`);
    }

    return result.rows[0];
  }

  /**
   * Send message between agents
   */
  async sendMessage(fromAgentId: string, toAgentId: string, messageType: string, payload: any): Promise<void> {
    await this.mainPool.query(
      `INSERT INTO neurobase_agent_messages (from_agent_id, to_agent_id, message_type, payload)
       VALUES ($1, $2, $3, $4)`,
      [fromAgentId, toAgentId, messageType, JSON.stringify(payload)]
    );

    logger.debug({ fromAgentId, toAgentId, messageType }, 'Message sent between agents');
  }

  /**
   * Get messages for an agent
   */
  async getMessages(agentId: string, unreadOnly: boolean = false): Promise<any[]> {
    const query = unreadOnly
      ? `SELECT * FROM neurobase_agent_messages WHERE to_agent_id = $1 AND read = FALSE ORDER BY created_at ASC`
      : `SELECT * FROM neurobase_agent_messages WHERE to_agent_id = $1 ORDER BY created_at DESC LIMIT 100`;

    const result = await this.mainPool.query(query, [agentId]);
    return result.rows;
  }

  /**
   * Mark message as read
   */
  async markMessageRead(messageId: string): Promise<void> {
    await this.mainPool.query(
      `UPDATE neurobase_agent_messages SET read = TRUE WHERE id = $1`,
      [messageId]
    );
  }

  /**
   * Record agent metrics
   */
  async recordMetric(agentId: string, metricName: string, metricValue: number, metadata?: any): Promise<void> {
    await this.mainPool.query(
      `INSERT INTO neurobase_agent_metrics (agent_id, metric_name, metric_value, metadata)
       VALUES ($1, $2, $3, $4)`,
      [agentId, metricName, metricValue, metadata ? JSON.stringify(metadata) : null]
    );
  }

  /**
   * Get agent metrics
   */
  async getAgentMetrics(agentId: string, metricName?: string, limit: number = 100): Promise<any[]> {
    const query = metricName
      ? `SELECT * FROM neurobase_agent_metrics
         WHERE agent_id = $1 AND metric_name = $2
         ORDER BY timestamp DESC LIMIT $3`
      : `SELECT * FROM neurobase_agent_metrics
         WHERE agent_id = $1
         ORDER BY timestamp DESC LIMIT $2`;

    const params = metricName ? [agentId, metricName, limit] : [agentId, limit];
    const result = await this.mainPool.query(query, params);
    return result.rows;
  }

  /**
   * Get all agents
   */
  getAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get orchestrator statistics
   */
  async getStatistics(): Promise<any> {
    const agents = Array.from(this.agents.values());

    // Get pending tasks count
    const pendingTasksResult = await this.mainPool.query(
      `SELECT COUNT(*) as count FROM neurobase_agent_tasks WHERE status = 'pending'`
    );

    const stats: any = {
      totalAgents: agents.length,
      runningAgents: agents.filter(a => a.status === 'running').length,
      idleAgents: agents.filter(a => a.status === 'idle').length,
      errorAgents: agents.filter(a => a.status === 'error').length,
      stoppedAgents: agents.filter(a => a.status === 'stopped').length,
      totalTasksProcessed: agents.reduce((sum, a) => sum + a.metrics.tasksProcessed, 0),
      totalErrors: agents.reduce((sum, a) => sum + a.metrics.errors, 0),
      avgProcessingTime: agents.length > 0
        ? agents.reduce((sum, a) => sum + a.metrics.avgProcessingTime, 0) / agents.length
        : 0,
      pendingTasks: parseInt(pendingTasksResult.rows[0].count),
      recentEvents: this.eventHistory.slice(-20),
    };

    return stats;
  }

  /**
   * Get event history
   */
  getEventHistory(limit: number = 100): OrchestratorEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Cleanup and shutdown orchestrator
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Multi-Agent Orchestrator');

    // Stop all running agents
    const runningAgents = Array.from(this.agents.values()).filter(a => a.status === 'running');

    for (const agent of runningAgents) {
      try {
        await this.stopAgent(agent.id, false); // Don't delete forks on shutdown
      } catch (error) {
        logger.error({ error, agentId: agent.id }, 'Error stopping agent during shutdown');
      }
    }

    // Close main pool
    await this.mainPool.end();

    logger.info('Multi-Agent Orchestrator shut down successfully');
  }
}
