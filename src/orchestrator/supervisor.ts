/**
 * Operation Supervisor
 * Classifies operations by risk level and enforces approval policies
 */

import { SQLSecurityAnalyzer } from '../security/sql-parser';
import { logger } from '../utils/logger';

export type RiskLevel = 'read' | 'write' | 'modify' | 'destructive';
export type ApprovalStatus = 'auto-approved' | 'sandbox-required' | 'human-approval-required' | 'blocked';

export interface OperationClassification {
  sql: string;
  riskLevel: RiskLevel;
  approvalStatus: ApprovalStatus;
  reason: string;
  estimatedRowsAffected?: number;
}

export interface ApprovalRequest {
  id: string;
  sql: string;
  riskLevel: RiskLevel;
  reason: string;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'rejected';
  respondedAt?: Date;
  respondedBy?: string;
}

export class OperationSupervisor {
  private securityAnalyzer: SQLSecurityAnalyzer;
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private modifyRowThreshold = 100; // Auto-approve UPDATE/DELETE if < 100 rows

  constructor() {
    this.securityAnalyzer = new SQLSecurityAnalyzer();
  }

  /**
   * Classify an operation and determine approval requirements
   */
  classify(sql: string, estimatedRows?: number): OperationClassification {
    const normalized = sql.trim().toUpperCase();
    const securityResult = this.securityAnalyzer.analyze(sql);

    // Blocked operations
    if (!securityResult.isAllowed) {
      return {
        sql,
        riskLevel: 'destructive',
        approvalStatus: 'blocked',
        reason: securityResult.issues.map(i => i.message).join('; '),
      };
    }

    // READ operations: SELECT
    if (/^(SELECT|WITH\s+.*SELECT|EXPLAIN)\s/i.test(normalized)) {
      return {
        sql,
        riskLevel: 'read',
        approvalStatus: 'auto-approved',
        reason: 'Read-only query',
      };
    }

    // WRITE operations: INSERT
    if (/^INSERT\s/i.test(normalized)) {
      return {
        sql,
        riskLevel: 'write',
        approvalStatus: 'auto-approved',
        reason: 'Insert operation - auto-approved with audit',
        estimatedRowsAffected: estimatedRows,
      };
    }

    // MODIFY operations: UPDATE
    if (/^UPDATE\s/i.test(normalized)) {
      if (!sql.toUpperCase().includes('WHERE')) {
        return {
          sql,
          riskLevel: 'destructive',
          approvalStatus: 'human-approval-required',
          reason: 'UPDATE without WHERE clause affects all rows',
          estimatedRowsAffected: estimatedRows,
        };
      }

      const status = (estimatedRows !== undefined && estimatedRows < this.modifyRowThreshold)
        ? 'auto-approved' as ApprovalStatus
        : 'sandbox-required' as ApprovalStatus;

      return {
        sql,
        riskLevel: 'modify',
        approvalStatus: status,
        reason: estimatedRows !== undefined
          ? `UPDATE affects ~${estimatedRows} rows`
          : 'UPDATE operation - sandbox test required',
        estimatedRowsAffected: estimatedRows,
      };
    }

    // DESTRUCTIVE operations: DELETE, DROP, TRUNCATE
    if (/^(DELETE|DROP|TRUNCATE)\s/i.test(normalized)) {
      // DELETE with WHERE and small scope can be sandbox-tested
      if (/^DELETE\s/i.test(normalized) && sql.toUpperCase().includes('WHERE')) {
        if (estimatedRows !== undefined && estimatedRows < this.modifyRowThreshold) {
          return {
            sql,
            riskLevel: 'modify',
            approvalStatus: 'sandbox-required',
            reason: `DELETE affects ~${estimatedRows} rows - sandbox test required`,
            estimatedRowsAffected: estimatedRows,
          };
        }
      }

      return {
        sql,
        riskLevel: 'destructive',
        approvalStatus: 'human-approval-required',
        reason: 'Destructive operation requires human approval',
        estimatedRowsAffected: estimatedRows,
      };
    }

    // DDL operations
    if (/^(ALTER|CREATE)\s/i.test(normalized)) {
      return {
        sql,
        riskLevel: 'destructive',
        approvalStatus: 'human-approval-required',
        reason: 'Schema modification requires human approval',
      };
    }

    // Default: require sandbox
    return {
      sql,
      riskLevel: 'modify',
      approvalStatus: 'sandbox-required',
      reason: 'Unknown operation type - sandbox test required',
    };
  }

  /**
   * Request human approval for a destructive operation
   */
  requestApproval(sql: string, reason: string): string {
    const id = `approval-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const request: ApprovalRequest = {
      id,
      sql,
      riskLevel: 'destructive',
      reason,
      requestedAt: new Date(),
      status: 'pending',
    };

    this.pendingApprovals.set(id, request);
    logger.warn({ id, sql: sql.substring(0, 100), reason }, 'Human approval requested');

    return id;
  }

  /**
   * Respond to an approval request
   */
  respondToApproval(requestId: string, approved: boolean, respondedBy?: string): boolean {
    const request = this.pendingApprovals.get(requestId);
    if (!request || request.status !== 'pending') return false;

    request.status = approved ? 'approved' : 'rejected';
    request.respondedAt = new Date();
    request.respondedBy = respondedBy;

    logger.info({ requestId, approved, respondedBy }, 'Approval response received');
    return true;
  }

  /**
   * Check if an approval was granted
   */
  isApproved(requestId: string): boolean {
    const request = this.pendingApprovals.get(requestId);
    return request?.status === 'approved';
  }

  /**
   * Get pending approval requests
   */
  getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).filter(r => r.status === 'pending');
  }

  getStats(): { pending: number; approved: number; rejected: number } {
    const all = Array.from(this.pendingApprovals.values());
    return {
      pending: all.filter(r => r.status === 'pending').length,
      approved: all.filter(r => r.status === 'approved').length,
      rejected: all.filter(r => r.status === 'rejected').length,
    };
  }
}
