/**
 * Agent Health Monitor
 * Tracks agent health metrics and performs auto-healing
 */

import { logger } from '../utils/logger';

export interface AgentHealth {
  agentId: string;
  errorRate: number; // percentage
  responseTimes: { p50: number; p95: number; p99: number };
  throughput: number; // requests per minute
  memoryUsageMB: number;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unresponsive';
  lastHeartbeat: Date;
  consecutiveErrors: number;
}

export interface HealthAction {
  type: 'restart' | 'reduce-load' | 'kill-recreate' | 'alert';
  agentId: string;
  reason: string;
  timestamp: Date;
}

export class HealthMonitor {
  private agents: Map<string, AgentHealth> = new Map();
  private responseTimes: Map<string, number[]> = new Map();
  private actions: HealthAction[] = [];
  private monitorInterval?: NodeJS.Timeout;

  // Thresholds
  private errorRateThreshold = 50; // %
  private latencyThreshold = 10000; // ms
  private unresponsiveTimeout = 60000; // ms

  /**
   * Register an agent for monitoring
   */
  registerAgent(agentId: string): void {
    this.agents.set(agentId, {
      agentId,
      errorRate: 0,
      responseTimes: { p50: 0, p95: 0, p99: 0 },
      throughput: 0,
      memoryUsageMB: 0,
      status: 'healthy',
      lastHeartbeat: new Date(),
      consecutiveErrors: 0,
    });
    this.responseTimes.set(agentId, []);
  }

  /**
   * Record a successful operation
   */
  recordSuccess(agentId: string, responseTimeMs: number): void {
    const health = this.agents.get(agentId);
    if (!health) return;

    health.lastHeartbeat = new Date();
    health.consecutiveErrors = 0;

    const times = this.responseTimes.get(agentId) || [];
    times.push(responseTimeMs);
    if (times.length > 1000) times.shift(); // Keep last 1000
    this.responseTimes.set(agentId, times);

    this.updateMetrics(agentId);
  }

  /**
   * Record a failed operation
   */
  recordError(agentId: string): void {
    const health = this.agents.get(agentId);
    if (!health) return;

    health.lastHeartbeat = new Date();
    health.consecutiveErrors++;
    this.updateMetrics(agentId);
  }

  /**
   * Record a heartbeat (agent is alive)
   */
  recordHeartbeat(agentId: string): void {
    const health = this.agents.get(agentId);
    if (health) {
      health.lastHeartbeat = new Date();
    }
  }

  /**
   * Get health status for an agent
   */
  getHealth(agentId: string): AgentHealth | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agent health statuses
   */
  getAllHealth(): AgentHealth[] {
    return Array.from(this.agents.values());
  }

  /**
   * Start periodic health checking
   */
  startMonitoring(intervalMs: number = 10000): void {
    this.monitorInterval = setInterval(() => this.checkAllAgents(), intervalMs);
    logger.info({ intervalMs }, 'Health monitoring started');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
  }

  /**
   * Get recent health actions
   */
  getActions(limit: number = 50): HealthAction[] {
    return this.actions.slice(-limit);
  }

  private updateMetrics(agentId: string): void {
    const health = this.agents.get(agentId);
    if (!health) return;

    const times = this.responseTimes.get(agentId) || [];

    if (times.length > 0) {
      const sorted = [...times].sort((a, b) => a - b);
      health.responseTimes = {
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      };
      health.throughput = times.length; // Simplified
    }

    // Calculate error rate
    const totalOps = times.length + health.consecutiveErrors;
    if (totalOps > 0) {
      health.errorRate = (health.consecutiveErrors / Math.max(totalOps, 10)) * 100;
    }

    // Update memory (Node.js process memory as proxy)
    health.memoryUsageMB = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));

    // Determine status
    health.status = this.determineStatus(health);
  }

  private determineStatus(health: AgentHealth): AgentHealth['status'] {
    const timeSinceHeartbeat = Date.now() - health.lastHeartbeat.getTime();

    if (timeSinceHeartbeat > this.unresponsiveTimeout) return 'unresponsive';
    if (health.errorRate > this.errorRateThreshold) return 'unhealthy';
    if (health.responseTimes.p95 > this.latencyThreshold) return 'degraded';
    if (health.consecutiveErrors > 5) return 'degraded';
    return 'healthy';
  }

  private checkAllAgents(): void {
    for (const health of this.agents.values()) {
      this.updateMetrics(health.agentId);

      switch (health.status) {
        case 'unresponsive':
          this.createAction('kill-recreate', health.agentId, 'Agent unresponsive for >60s');
          break;
        case 'unhealthy':
          this.createAction('restart', health.agentId, `Error rate ${health.errorRate.toFixed(1)}% exceeds threshold`);
          break;
        case 'degraded':
          this.createAction('reduce-load', health.agentId, `P95 latency ${health.responseTimes.p95}ms exceeds threshold`);
          break;
      }
    }
  }

  private createAction(type: HealthAction['type'], agentId: string, reason: string): void {
    // Don't create duplicate actions within 5 minutes
    const recent = this.actions.filter(a =>
      a.agentId === agentId &&
      a.type === type &&
      Date.now() - a.timestamp.getTime() < 5 * 60 * 1000
    );
    if (recent.length > 0) return;

    const action: HealthAction = { type, agentId, reason, timestamp: new Date() };
    this.actions.push(action);

    // Keep only last 500 actions
    if (this.actions.length > 500) this.actions.shift();

    logger.warn({ action }, 'Health monitor action triggered');
  }
}
