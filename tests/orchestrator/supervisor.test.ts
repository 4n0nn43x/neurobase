/**
 * Operation supervisor — risk classification + permission ladder enforcement.
 */

import { OperationSupervisor } from '../../src/orchestrator/supervisor';

describe('OperationSupervisor.classify', () => {
  const sup = new OperationSupervisor();

  it('classifies SELECT as read / auto-approved', () => {
    const c = sup.classify('SELECT * FROM users');
    expect(c.riskLevel).toBe('read');
    expect(c.approvalStatus).toBe('auto-approved');
  });

  it('blocks SQL the analyzer flags as dangerous', () => {
    const c = sup.classify('DROP TABLE users');
    expect(c.approvalStatus).toBe('blocked');
  });

  it('escalates UPDATE without WHERE to human approval', () => {
    const c = sup.classify('UPDATE users SET active = false');
    expect(c.approvalStatus).toBe('blocked');
  });

  it('marks DELETE with WHERE for sandbox / approval depending on rows', () => {
    const small = sup.classify('DELETE FROM users WHERE id = 1', 10);
    expect(small.approvalStatus).toBe('sandbox-required');
    const large = sup.classify('DELETE FROM users WHERE id = 1', 10_000);
    expect(large.approvalStatus).toBe('human-approval-required');
  });
});

describe('OperationSupervisor.enforce', () => {
  const sup = new OperationSupervisor();

  it('read-only allows SELECT', () => {
    const r = sup.enforce('SELECT * FROM users', 'read-only');
    expect(r.allowed).toBe(true);
  });

  it('read-only rejects INSERT', () => {
    const r = sup.enforce('INSERT INTO users (id) VALUES (1)', 'read-only');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/read-only/);
  });

  it('write allows INSERT and UPDATE with WHERE', () => {
    expect(sup.enforce('INSERT INTO users (id) VALUES (1)', 'write').allowed).toBe(true);
    expect(sup.enforce('UPDATE users SET active = true WHERE id = 1', 'write').allowed).toBe(true);
  });

  it('write rejects DROP TABLE (analyzer blocks first)', () => {
    const r = sup.enforce('DROP TABLE users', 'write');
    expect(r.allowed).toBe(false);
  });

  it('admin still rejects GRANT (analyzer block, not a ladder bypass)', () => {
    const r = sup.enforce('GRANT ALL ON users TO PUBLIC', 'admin');
    expect(r.allowed).toBe(false);
  });

  it('reports requiresApproval=true on sandbox-required ops', () => {
    const r = sup.enforce('DELETE FROM users WHERE id = 1', 'write', 5);
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });
});
