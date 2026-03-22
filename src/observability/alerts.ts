/**
 * Alert System
 * Monitors metrics and triggers alerts via configurable channels
 */

import { logger } from '../utils/logger';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertChannel = 'webhook' | 'log';

export interface AlertRule {
  id: string;
  name: string;
  condition: () => boolean;
  severity: AlertSeverity;
  message: string;
  cooldownMs: number; // Don't re-alert within this period
}

export interface Alert {
  id: string;
  ruleId: string;
  severity: AlertSeverity;
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  acknowledged: boolean;
}

export interface AlertConfig {
  enabled: boolean;
  webhookUrl?: string;
  channels: AlertChannel[];
  rules?: AlertRule[];
}

export class AlertSystem {
  private rules: Map<string, AlertRule> = new Map();
  private alerts: Alert[] = [];
  private lastAlerted: Map<string, Date> = new Map();
  private config: AlertConfig;
  private checkInterval?: NodeJS.Timeout;
  private maxAlerts = 1000;

  // Metric collectors
  private metrics: Map<string, number> = new Map();

  constructor(config: AlertConfig) {
    this.config = config;
    this.setupDefaultRules();
  }

  /**
   * Register an alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Update a metric value
   */
  setMetric(name: string, value: number): void {
    this.metrics.set(name, value);
  }

  /**
   * Get current metric value
   */
  getMetric(name: string): number {
    return this.metrics.get(name) || 0;
  }

  /**
   * Check all rules and fire alerts
   */
  async checkRules(): Promise<Alert[]> {
    const fired: Alert[] = [];

    for (const rule of this.rules.values()) {
      try {
        if (rule.condition()) {
          // Check cooldown
          const lastFired = this.lastAlerted.get(rule.id);
          if (lastFired && Date.now() - lastFired.getTime() < rule.cooldownMs) {
            continue;
          }

          const alert = await this.fireAlert(rule);
          fired.push(alert);
        }
      } catch (error) {
        logger.error({ error, ruleId: rule.id }, 'Error evaluating alert rule');
      }
    }

    return fired;
  }

  /**
   * Start periodic rule checking
   */
  startMonitoring(intervalMs: number = 30000): void {
    this.checkInterval = setInterval(() => this.checkRules(), intervalMs);
    logger.info({ intervalMs }, 'Alert monitoring started');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  /**
   * Get recent alerts
   */
  getAlerts(limit: number = 50): Alert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * Get unacknowledged alerts
   */
  getUnacknowledgedAlerts(): Alert[] {
    return this.alerts.filter(a => !a.acknowledged);
  }

  private async fireAlert(rule: AlertRule): Promise<Alert> {
    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      ruleId: rule.id,
      severity: rule.severity,
      message: rule.message,
      timestamp: new Date(),
      metadata: Object.fromEntries(this.metrics),
      acknowledged: false,
    };

    this.alerts.push(alert);
    this.lastAlerted.set(rule.id, new Date());

    // Trim old alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(-this.maxAlerts);
    }

    // Send to channels
    for (const channel of this.config.channels) {
      await this.sendToChannel(channel, alert);
    }

    logger.warn({ alert: { id: alert.id, severity: alert.severity, message: alert.message } }, 'Alert fired');

    return alert;
  }

  private async sendToChannel(channel: AlertChannel, alert: Alert): Promise<void> {
    switch (channel) {
      case 'webhook':
        if (this.config.webhookUrl) {
          try {
            const response = await fetch(this.config.webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                severity: alert.severity,
                message: alert.message,
                timestamp: alert.timestamp.toISOString(),
                metadata: alert.metadata,
              }),
            });
            if (!response.ok) {
              logger.error({ status: response.status }, 'Failed to send webhook alert');
            }
          } catch (error) {
            logger.error({ error }, 'Failed to send webhook alert');
          }
        }
        break;

      case 'log':
        const logMethod = alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warn' : 'info';
        (logger as any)[logMethod]({ alertId: alert.id, severity: alert.severity }, `ALERT: ${alert.message}`);
        break;
    }
  }

  private setupDefaultRules(): void {
    // Error rate > 10%
    this.addRule({
      id: 'high-error-rate',
      name: 'High Error Rate',
      condition: () => this.getMetric('error_rate') > 10,
      severity: 'warning',
      message: `Error rate ${this.getMetric('error_rate').toFixed(1)}% exceeds 10% threshold`,
      cooldownMs: 5 * 60 * 1000,
    });

    // DROP/TRUNCATE attempt
    this.addRule({
      id: 'destructive-attempt',
      name: 'Destructive SQL Attempt',
      condition: () => this.getMetric('destructive_attempts') > 0,
      severity: 'critical',
      message: 'DROP or TRUNCATE statement attempted',
      cooldownMs: 60 * 1000,
    });

    // P95 > 5s
    this.addRule({
      id: 'high-latency',
      name: 'High Query Latency',
      condition: () => this.getMetric('p95_latency_ms') > 5000,
      severity: 'warning',
      message: `P95 latency ${this.getMetric('p95_latency_ms')}ms exceeds 5s threshold`,
      cooldownMs: 5 * 60 * 1000,
    });

    // Agent down > 2 min
    this.addRule({
      id: 'agent-down',
      name: 'Agent Down',
      condition: () => this.getMetric('agents_down') > 0,
      severity: 'critical',
      message: `${this.getMetric('agents_down')} agent(s) unresponsive for >2 minutes`,
      cooldownMs: 2 * 60 * 1000,
    });
  }
}
