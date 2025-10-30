#!/usr/bin/env node

/**
 * NeuroBase Multi-Agent REST API Server
 * Extended API with multi-agent orchestration capabilities
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import { config } from './config';
import { logger } from './utils/logger';
import { MultiAgentOrchestrator, AgentConfig } from './orchestrator/multi-agent-orchestrator';
import { ForkSynchronizer, SyncConfig } from './orchestrator/fork-synchronizer';
import { MonitoringDashboard } from './dashboard/monitor';
import { DatabaseForkManager } from './database/fork';

const app = express();
const port = config.neurobase.port || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for dashboard
}));
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.security.apiRateLimit || 100,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Initialize components
let orchestrator: MultiAgentOrchestrator;
let synchronizer: ForkSynchronizer;
let dashboard: MonitoringDashboard;
let forkManager: DatabaseForkManager;
let mainPool: Pool;

/**
 * Initialize multi-agent system
 */
async function initializeSystem(): Promise<void> {
  logger.info('Initializing Multi-Agent System');

  // Create main database pool
  mainPool = new Pool({
    connectionString: config.tiger.connectionString,
    max: 20,
  });

  // Initialize fork manager
  forkManager = new DatabaseForkManager();

  // Initialize orchestrator
  orchestrator = new MultiAgentOrchestrator(
    config.tiger.connectionString,
    forkManager.getCurrentServiceId()
  );

  await orchestrator.initialize();

  // Initialize synchronizer
  synchronizer = new ForkSynchronizer(mainPool);

  // Initialize dashboard
  dashboard = new MonitoringDashboard(orchestrator, synchronizer);
  dashboard.setupRoutes(app);
  dashboard.startMonitoring();

  logger.info('Multi-Agent System initialized successfully');
}

/**
 * Error handler middleware
 */
const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error({ error: err }, 'API error');
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
};

// ============================================================================
// AGENT MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Register a new agent
 * POST /api/agents/register
 */
app.post('/api/agents/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agentConfig: AgentConfig = req.body;

    if (!agentConfig.name || !agentConfig.type) {
      res.status(400).json({
        success: false,
        error: 'Agent name and type are required',
      });
      return;
    }

    const agent = await orchestrator.registerAgent(agentConfig);

    res.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.config.name,
        type: agent.config.type,
        status: agent.status,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get all agents
 * GET /api/agents
 */
app.get('/api/agents', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const agents = orchestrator.getAgents();

    res.json({
      success: true,
      agents: agents.map(agent => ({
        id: agent.id,
        name: agent.config.name,
        type: agent.config.type,
        status: agent.status,
        forkId: agent.fork?.id,
        metrics: agent.metrics,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get agent by ID
 * GET /api/agents/:agentId
 */
app.get('/api/agents/:agentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agent = orchestrator.getAgent(req.params.agentId);

    if (!agent) {
      res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
      return;
    }

    res.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.config.name,
        type: agent.config.type,
        status: agent.status,
        forkId: agent.fork?.id,
        metrics: agent.metrics,
        lastActivity: agent.lastActivity,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Start an agent
 * POST /api/agents/:agentId/start
 */
app.post('/api/agents/:agentId/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await orchestrator.startAgent(req.params.agentId);

    res.json({
      success: true,
      message: 'Agent started successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Stop an agent
 * POST /api/agents/:agentId/stop
 */
app.post('/api/agents/:agentId/stop', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleteFork = req.body.deleteFork || false;
    await orchestrator.stopAgent(req.params.agentId, deleteFork);

    res.json({
      success: true,
      message: 'Agent stopped successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Submit task to agent
 * POST /api/agents/:agentId/tasks
 */
app.post('/api/agents/:agentId/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { taskType, payload, priority } = req.body;

    if (!taskType) {
      res.status(400).json({
        success: false,
        error: 'Task type is required',
      });
      return;
    }

    const taskId = await orchestrator.submitTask(
      req.params.agentId,
      taskType,
      payload,
      priority
    );

    res.json({
      success: true,
      taskId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get task status
 * GET /api/tasks/:taskId
 */
app.get('/api/tasks/:taskId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await orchestrator.getTaskStatus(req.params.taskId);

    res.json({
      success: true,
      task,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// SCHEMA EVOLUTION ENDPOINTS
// ============================================================================

/**
 * Trigger schema analysis
 * POST /api/schema/analyze
 */
app.post('/api/schema/analyze', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // This would use the Schema Evolution Agent
    // For now, return placeholder

    res.json({
      success: true,
      message: 'Schema analysis started',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// QUERY VALIDATION ENDPOINTS
// ============================================================================

/**
 * Validate a query
 * POST /api/validate
 */
app.post('/api/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sql } = req.body;

    if (!sql) {
      res.status(400).json({
        success: false,
        error: 'SQL query is required',
      });
      return;
    }

    // This would use the Query Validator Agent
    // For now, return placeholder

    res.json({
      success: true,
      validation: {
        isValid: true,
        isSafe: true,
        warnings: [],
        errors: [],
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// A/B TESTING ENDPOINTS
// ============================================================================

/**
 * Create A/B test experiment
 * POST /api/experiments
 */
app.post('/api/experiments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, strategies } = req.body;

    if (!name || !strategies || strategies.length < 2) {
      res.status(400).json({
        success: false,
        error: 'Experiment name and at least 2 strategies are required',
      });
      return;
    }

    // This would use the A/B Testing Agent
    // For now, return placeholder

    res.json({
      success: true,
      experimentId: `exp-${Date.now()}`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get experiments
 * GET /api/experiments
 */
app.get('/api/experiments', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // This would use the A/B Testing Agent
    // For now, return placeholder

    res.json({
      success: true,
      experiments: [],
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// SYNCHRONIZATION ENDPOINTS
// ============================================================================

/**
 * Create sync job
 * POST /api/sync
 */
app.post('/api/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const syncConfig: SyncConfig = req.body;

    if (!syncConfig.source || !syncConfig.target || !syncConfig.tables) {
      res.status(400).json({
        success: false,
        error: 'Source, target, and tables are required',
      });
      return;
    }

    const job = await synchronizer.createSyncJob(syncConfig);

    // Execute sync asynchronously
    synchronizer.executeSync(job.id).catch(error => {
      logger.error({ error, jobId: job.id }, 'Sync job failed');
    });

    res.json({
      success: true,
      jobId: job.id,
      status: job.status,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get sync job status
 * GET /api/sync/:jobId
 */
app.get('/api/sync/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = synchronizer.getSyncJob(req.params.jobId);

    if (!job) {
      res.status(404).json({
        success: false,
        error: 'Sync job not found',
      });
      return;
    }

    res.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        recordsSynced: job.recordsSynced,
        errors: job.errors,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get all sync jobs
 * GET /api/sync
 */
app.get('/api/sync', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const jobs = synchronizer.getAllSyncJobs();

    res.json({
      success: true,
      jobs: jobs.map(job => ({
        id: job.id,
        status: job.status,
        progress: job.progress,
        recordsSynced: job.recordsSynced,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// LEARNING & INSIGHTS ENDPOINTS
// ============================================================================

/**
 * Get learning insights
 * GET /api/insights
 */
app.get('/api/insights', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // This would use the Learning Aggregator Agent
    // For now, return placeholder

    res.json({
      success: true,
      insights: [],
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get knowledge graph
 * GET /api/knowledge-graph
 */
app.get('/api/knowledge-graph', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // This would use the Learning Aggregator Agent
    // For now, return placeholder

    res.json({
      success: true,
      graph: {
        nodes: [],
        edges: [],
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// STATISTICS & MONITORING ENDPOINTS
// ============================================================================

/**
 * Get system statistics
 * GET /api/statistics
 */
app.get('/api/statistics', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await orchestrator.getStatistics();

    res.json({
      success: true,
      statistics: stats,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Health check
 * GET /health
 */
app.get('/health', async (_req: Request, res: Response) => {
  try {
    const stats = await orchestrator.getStatistics();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      agents: {
        total: stats.totalAgents,
        running: stats.runningAgents,
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: String(error),
    });
  }
});

// Apply error handler
app.use(errorHandler);

/**
 * Start the server
 */
async function start() {
  try {
    await initializeSystem();

    app.listen(port, () => {
      logger.info({ port }, '🚀 NeuroBase Multi-Agent API Server started');
      logger.info(`📊 Dashboard: http://localhost:${port}/dashboard`);
      logger.info(`🔗 API: http://localhost:${port}/api`);
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down Multi-Agent System');

  await orchestrator.shutdown();
  await synchronizer.shutdown();
  await mainPool.end();

  process.exit(0);
});

// Start if executed directly
if (require.main === module) {
  start();
}

export { app, orchestrator, synchronizer, dashboard };
