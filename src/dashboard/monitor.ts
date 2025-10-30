/**
 * Multi-Agent Monitoring Dashboard
 * Real-time monitoring and visualization of multi-agent system
 */

import { Express, Request, Response } from 'express';
import { MultiAgentOrchestrator } from '../orchestrator/multi-agent-orchestrator';
import { ForkSynchronizer } from '../orchestrator/fork-synchronizer';
import { logger } from '../utils/logger';

export interface DashboardMetrics {
  system: SystemMetrics;
  agents: AgentMetrics[];
  forks: ForkMetrics[];
  synchronization: SyncMetrics;
  performance: PerformanceMetrics;
  insights: InsightMetrics;
}

export interface SystemMetrics {
  uptime: number;
  totalAgents: number;
  activeAgents: number;
  totalForks: number;
  totalTasks: number;
  completedTasks: number;
  timestamp: Date;
}

export interface AgentMetrics {
  id: string;
  name: string;
  type: string;
  status: string;
  forkId?: string;
  tasksProcessed: number;
  successRate: number;
  avgProcessingTime: number;
  lastActivity?: Date;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface ForkMetrics {
  id: string;
  name: string;
  agentId: string;
  status: string;
  createdAt: Date;
  size?: number;
  connections?: number;
}

export interface SyncMetrics {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  recordsSynced: number;
  lastSyncTime?: Date;
}

export interface PerformanceMetrics {
  avgQueryTime: number;
  queriesPerSecond: number;
  errorRate: number;
  cacheHitRate: number;
}

export interface InsightMetrics {
  totalInsights: number;
  actionableInsights: number;
  highImpactInsights: number;
  recentInsights: any[];
}

export class MonitoringDashboard {
  private orchestrator: MultiAgentOrchestrator;
  private synchronizer?: ForkSynchronizer;
  private startTime: Date;
  private metricsHistory: DashboardMetrics[] = [];
  private maxHistorySize: number = 1000;

  constructor(
    orchestrator: MultiAgentOrchestrator,
    synchronizer?: ForkSynchronizer
  ) {
    this.orchestrator = orchestrator;
    this.synchronizer = synchronizer;
    this.startTime = new Date();
  }

  /**
   * Setup dashboard routes
   */
  setupRoutes(app: Express): void {
    logger.info('Setting up monitoring dashboard routes');

    // Main dashboard page
    app.get('/dashboard', (_req: Request, res: Response) => {
      res.send(this.getDashboardHTML());
    });

    // API endpoints for dashboard data
    app.get('/api/dashboard/metrics', async (_req: Request, res: Response) => {
      try {
        const metrics = await this.getMetrics();
        res.json(metrics);
      } catch (error: any) {
        logger.error({ error }, 'Error fetching dashboard metrics');
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/dashboard/agents', async (_req: Request, res: Response) => {
      try {
        const agents = await this.getAgentMetrics();
        res.json(agents);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/dashboard/events', async (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const events = this.orchestrator.getEventHistory(limit);
        res.json(events);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/dashboard/statistics', async (_req: Request, res: Response) => {
      try {
        const stats = await this.orchestrator.getStatistics();
        res.json(stats);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/dashboard/history', async (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 100;
        res.json(this.metricsHistory.slice(-limit));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Agent control endpoints
    app.post('/api/dashboard/agents/:agentId/start', async (req: Request, res: Response) => {
      try {
        await this.orchestrator.startAgent(req.params.agentId);
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/dashboard/agents/:agentId/stop', async (req: Request, res: Response) => {
      try {
        await this.orchestrator.stopAgent(req.params.agentId);
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    logger.info('Dashboard routes configured');
  }

  /**
   * Collect all metrics
   */
  async getMetrics(): Promise<DashboardMetrics> {
    const [system, agents, forks, sync, performance, insights] = await Promise.all([
      this.getSystemMetrics(),
      this.getAgentMetrics(),
      this.getForkMetrics(),
      this.getSyncMetrics(),
      this.getPerformanceMetrics(),
      this.getInsightMetrics(),
    ]);

    const metrics: DashboardMetrics = {
      system,
      agents,
      forks,
      synchronization: sync,
      performance,
      insights,
    };

    // Store in history
    this.metricsHistory.push(metrics);
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory.shift();
    }

    return metrics;
  }

  /**
   * Get system metrics
   */
  private async getSystemMetrics(): Promise<SystemMetrics> {
    const stats = await this.orchestrator.getStatistics();
    const uptime = Date.now() - this.startTime.getTime();

    return {
      uptime,
      totalAgents: stats.totalAgents || 0,
      activeAgents: stats.runningAgents || 0,
      totalForks: stats.totalAgents || 0, // Approximation
      totalTasks: stats.totalTasksProcessed || 0,
      completedTasks: stats.totalTasksProcessed || 0,
      timestamp: new Date(),
    };
  }

  /**
   * Get agent metrics
   */
  private async getAgentMetrics(): Promise<AgentMetrics[]> {
    const agents = this.orchestrator.getAgents();

    return agents.map(agent => ({
      id: agent.id,
      name: agent.config.name,
      type: agent.config.type,
      status: agent.status,
      forkId: agent.fork?.id,
      tasksProcessed: agent.metrics.tasksProcessed,
      successRate: agent.metrics.tasksProcessed > 0
        ? ((agent.metrics.tasksProcessed - agent.metrics.errors) / agent.metrics.tasksProcessed) * 100
        : 0,
      avgProcessingTime: agent.metrics.avgProcessingTime,
      lastActivity: agent.lastActivity,
    }));
  }

  /**
   * Get fork metrics
   */
  private async getForkMetrics(): Promise<ForkMetrics[]> {
    const agents = this.orchestrator.getAgents();

    return agents
      .filter(agent => agent.fork)
      .map(agent => ({
        id: agent.fork!.id,
        name: agent.fork!.name,
        agentId: agent.id,
        status: agent.fork!.status,
        createdAt: new Date(agent.fork!.createdAt),
      }));
  }

  /**
   * Get synchronization metrics
   */
  private async getSyncMetrics(): Promise<SyncMetrics> {
    if (!this.synchronizer) {
      return {
        totalJobs: 0,
        activeJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        recordsSynced: 0,
      };
    }

    const stats = this.synchronizer.getStatistics();

    return {
      totalJobs: stats.totalJobs || 0,
      activeJobs: stats.runningJobs || 0,
      completedJobs: stats.completedJobs || 0,
      failedJobs: stats.failedJobs || 0,
      recordsSynced: stats.totalRecordsSynced || 0,
    };
  }

  /**
   * Get performance metrics
   */
  private async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const stats = await this.orchestrator.getStatistics();

    return {
      avgQueryTime: stats.avgProcessingTime || 0,
      queriesPerSecond: 0, // Would need time-series data
      errorRate: stats.totalErrors && stats.totalTasksProcessed
        ? (stats.totalErrors / stats.totalTasksProcessed) * 100
        : 0,
      cacheHitRate: 0, // Would need cache statistics
    };
  }

  /**
   * Get insight metrics
   */
  private async getInsightMetrics(): Promise<InsightMetrics> {
    // This would integrate with Learning Aggregator Agent
    return {
      totalInsights: 0,
      actionableInsights: 0,
      highImpactInsights: 0,
      recentInsights: [],
    };
  }

  /**
   * Generate dashboard HTML
   */
  private getDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NeuroBase Multi-Agent Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        header {
            background: white;
            padding: 20px 30px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            margin-bottom: 20px;
        }

        h1 {
            color: #667eea;
            font-size: 28px;
            margin-bottom: 5px;
        }

        .subtitle {
            color: #666;
            font-size: 14px;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }

        .card {
            background: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .card h2 {
            font-size: 18px;
            color: #667eea;
            margin-bottom: 15px;
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
        }

        .metric {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid #eee;
        }

        .metric:last-child {
            border-bottom: none;
        }

        .metric-label {
            color: #666;
            font-size: 14px;
        }

        .metric-value {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
        }

        .status {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
        }

        .status-running {
            background: #4ade80;
            color: white;
        }

        .status-idle {
            background: #fbbf24;
            color: white;
        }

        .status-error {
            background: #ef4444;
            color: white;
        }

        .status-stopped {
            background: #9ca3af;
            color: white;
        }

        .agent-list {
            list-style: none;
        }

        .agent-item {
            background: #f9fafb;
            padding: 15px;
            margin-bottom: 10px;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }

        .agent-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .agent-name {
            font-weight: bold;
            color: #333;
        }

        .agent-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            font-size: 12px;
            color: #666;
        }

        .event-list {
            max-height: 400px;
            overflow-y: auto;
        }

        .event-item {
            padding: 10px;
            margin-bottom: 8px;
            background: #f9fafb;
            border-radius: 6px;
            font-size: 13px;
        }

        .event-time {
            color: #9ca3af;
            font-size: 11px;
        }

        .event-type {
            font-weight: bold;
            color: #667eea;
        }

        .refresh-btn {
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: #667eea;
            color: white;
            border: none;
            padding: 15px 25px;
            border-radius: 50px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
            transition: all 0.3s;
        }

        .refresh-btn:hover {
            background: #5568d3;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
        }

        .auto-refresh {
            position: fixed;
            bottom: 30px;
            left: 30px;
            background: white;
            padding: 10px 20px;
            border-radius: 50px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            font-size: 12px;
            color: #666;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: #667eea;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .pulse {
            animation: pulse 2s infinite;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🧠 NeuroBase Multi-Agent Dashboard</h1>
            <p class="subtitle">Real-time monitoring of autonomous database agents</p>
        </header>

        <div class="grid">
            <div class="card">
                <h2>📊 System Overview</h2>
                <div id="system-metrics" class="loading pulse">Loading...</div>
            </div>

            <div class="card">
                <h2>⚡ Performance</h2>
                <div id="performance-metrics" class="loading pulse">Loading...</div>
            </div>

            <div class="card">
                <h2>🔄 Synchronization</h2>
                <div id="sync-metrics" class="loading pulse">Loading...</div>
            </div>
        </div>

        <div class="grid">
            <div class="card" style="grid-column: 1 / -1;">
                <h2>🤖 Active Agents</h2>
                <ul id="agent-list" class="agent-list loading pulse">Loading...</ul>
            </div>
        </div>

        <div class="grid">
            <div class="card" style="grid-column: 1 / -1;">
                <h2>📝 Recent Events</h2>
                <div id="event-list" class="event-list loading pulse">Loading...</div>
            </div>
        </div>

        <div class="auto-refresh">
            Auto-refresh: <strong id="refresh-timer">--</strong>
        </div>

        <button class="refresh-btn" onclick="loadDashboardData()">
            🔄 Refresh Now
        </button>
    </div>

    <script>
        let refreshInterval;
        let countdown = 10;

        async function loadDashboardData() {
            try {
                const metrics = await fetch('/api/dashboard/metrics').then(r => r.json());
                const events = await fetch('/api/dashboard/events?limit=20').then(r => r.json());

                updateSystemMetrics(metrics.system);
                updatePerformanceMetrics(metrics.performance);
                updateSyncMetrics(metrics.synchronization);
                updateAgentList(metrics.agents);
                updateEventList(events);

                countdown = 10;
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            }
        }

        function updateSystemMetrics(system) {
            const html = \`
                <div class="metric">
                    <span class="metric-label">Total Agents</span>
                    <span class="metric-value">\${system.totalAgents}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Active Agents</span>
                    <span class="metric-value">\${system.activeAgents}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Total Tasks</span>
                    <span class="metric-value">\${system.totalTasks}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Uptime</span>
                    <span class="metric-value">\${formatUptime(system.uptime)}</span>
                </div>
            \`;
            document.getElementById('system-metrics').innerHTML = html;
        }

        function updatePerformanceMetrics(performance) {
            const html = \`
                <div class="metric">
                    <span class="metric-label">Avg Query Time</span>
                    <span class="metric-value">\${performance.avgQueryTime.toFixed(0)}ms</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Error Rate</span>
                    <span class="metric-value">\${performance.errorRate.toFixed(1)}%</span>
                </div>
            \`;
            document.getElementById('performance-metrics').innerHTML = html;
        }

        function updateSyncMetrics(sync) {
            const html = \`
                <div class="metric">
                    <span class="metric-label">Total Jobs</span>
                    <span class="metric-value">\${sync.totalJobs}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Active Jobs</span>
                    <span class="metric-value">\${sync.activeJobs}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Records Synced</span>
                    <span class="metric-value">\${sync.recordsSynced}</span>
                </div>
            \`;
            document.getElementById('sync-metrics').innerHTML = html;
        }

        function updateAgentList(agents) {
            if (agents.length === 0) {
                document.getElementById('agent-list').innerHTML = '<li>No agents registered</li>';
                return;
            }

            const html = agents.map(agent => \`
                <li class="agent-item">
                    <div class="agent-header">
                        <span class="agent-name">\${agent.name}</span>
                        <span class="status status-\${agent.status}">\${agent.status.toUpperCase()}</span>
                    </div>
                    <div class="agent-stats">
                        <div><strong>Type:</strong> \${agent.type}</div>
                        <div><strong>Tasks:</strong> \${agent.tasksProcessed}</div>
                        <div><strong>Success:</strong> \${agent.successRate.toFixed(1)}%</div>
                    </div>
                </li>
            \`).join('');

            document.getElementById('agent-list').innerHTML = html;
        }

        function updateEventList(events) {
            if (events.length === 0) {
                document.getElementById('event-list').innerHTML = '<div>No recent events</div>';
                return;
            }

            const html = events.map(event => \`
                <div class="event-item">
                    <div class="event-type">\${event.type}</div>
                    <div class="event-time">\${new Date(event.timestamp).toLocaleString()}</div>
                </div>
            \`).join('');

            document.getElementById('event-list').innerHTML = html;
        }

        function formatUptime(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (days > 0) return \`\${days}d \${hours % 24}h\`;
            if (hours > 0) return \`\${hours}h \${minutes % 60}m\`;
            if (minutes > 0) return \`\${minutes}m\`;
            return \`\${seconds}s\`;
        }

        function updateCountdown() {
            document.getElementById('refresh-timer').textContent = \`\${countdown}s\`;
            countdown--;
            if (countdown < 0) {
                loadDashboardData();
            }
        }

        // Initial load
        loadDashboardData();

        // Auto-refresh every 10 seconds
        refreshInterval = setInterval(updateCountdown, 1000);
    </script>
</body>
</html>
    `;
  }

  /**
   * Start collecting metrics periodically
   */
  startMonitoring(intervalMs: number = 5000): void {
    logger.info({ intervalMs }, 'Starting dashboard monitoring');

    setInterval(async () => {
      try {
        await this.getMetrics();
      } catch (error) {
        logger.error({ error }, 'Error collecting metrics');
      }
    }, intervalMs);
  }
}
