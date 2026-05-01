/**
 * SQL security analyzer — orchestrator + each focused check module.
 */

import { SQLSecurityAnalyzer } from '../../src/security/sql-parser';
import { checkMultiStatement, checkCommentInjection } from '../../src/security/sql/injection';
import { checkAstDestructive, checkRegexDestructive } from '../../src/security/sql/destructive';
import { checkAstPrivilege, checkRegexPrivilege } from '../../src/security/sql/privilege';
import { checkAstDDL, isDDL } from '../../src/security/sql/ddl';
import { checkSystemCatalogAccess } from '../../src/security/sql/system-catalog';

describe('SQLSecurityAnalyzer', () => {
  const analyzer = new SQLSecurityAnalyzer();

  it('allows a simple SELECT', () => {
    const r = analyzer.analyze('SELECT * FROM users WHERE id = 1');
    expect(r.isAllowed).toBe(true);
    expect(r.statementType).toBe('select');
    expect(r.issues).toEqual([]);
  });

  it('blocks DROP TABLE', () => {
    const r = analyzer.analyze('DROP TABLE users');
    expect(r.isAllowed).toBe(false);
    expect(r.issues.some((i) => i.category === 'ddl')).toBe(true);
  });

  it('flags DELETE without WHERE as critical', () => {
    const r = analyzer.analyze('DELETE FROM users');
    expect(r.isAllowed).toBe(false);
    expect(r.issues.some((i) => i.severity === 'critical' && i.category === 'destructive')).toBe(true);
  });

  it('allows DELETE with WHERE', () => {
    const r = analyzer.analyze('DELETE FROM users WHERE id = 1');
    expect(r.isAllowed).toBe(true);
  });

  it('flags UPDATE without WHERE as high', () => {
    const r = analyzer.analyze('UPDATE users SET active = false');
    expect(r.isAllowed).toBe(false);
    expect(r.issues.some((i) => i.severity === 'high' && i.category === 'destructive')).toBe(true);
  });

  it('blocks GRANT', () => {
    const r = analyzer.analyze('GRANT ALL ON users TO PUBLIC');
    expect(r.isAllowed).toBe(false);
    expect(r.issues.some((i) => i.category === 'privilege')).toBe(true);
  });

  it('detects multi-statement injection', () => {
    const r = analyzer.analyze('SELECT 1; DROP TABLE users;');
    expect(r.isAllowed).toBe(false);
    expect(r.issues.some((i) => i.category === 'injection')).toBe(true);
  });

  it('detects system-catalog access', () => {
    const r = analyzer.analyze('SELECT * FROM pg_shadow');
    expect(r.isAllowed).toBe(false);
    expect(r.issues.some((i) => i.category === 'reconnaissance')).toBe(true);
  });

  it('extracts the table list (real tables, ignoring aliases is best-effort)', () => {
    const r = analyzer.analyze('SELECT u.* FROM users u JOIN orders o ON u.id = o.user_id WHERE u.id = 1');
    // Some node-sql-parser versions surface aliases as tables; we just want
    // to make sure the real tables are present.
    expect(r.tablesAccessed).toContain('users');
    expect(r.tablesAccessed).toContain('orders');
  });

  it('isSafe is a shortcut for analyze().isAllowed', () => {
    expect(analyzer.isSafe('SELECT 1')).toBe(true);
    expect(analyzer.isSafe('DROP TABLE x')).toBe(false);
  });
});

describe('focused check modules', () => {
  describe('injection', () => {
    it('multi-statement: triggers on stacked queries', () => {
      expect(checkMultiStatement('SELECT 1; SELECT 2;')).toHaveLength(1);
    });

    it('multi-statement: single statement with trailing ; is OK', () => {
      expect(checkMultiStatement('SELECT 1;')).toHaveLength(0);
    });

    it('comment-injection: catches DROP after --', () => {
      expect(checkCommentInjection('SELECT 1 -- DROP TABLE users')).toHaveLength(1);
    });

    it('comment-injection: ignores plain comments', () => {
      expect(checkCommentInjection('SELECT 1 -- just a note')).toHaveLength(0);
    });
  });

  describe('destructive (AST)', () => {
    it('flags DELETE without where', () => {
      expect(checkAstDestructive({}, 'delete')).toHaveLength(1);
    });

    it('passes DELETE with where', () => {
      expect(checkAstDestructive({ where: {} }, 'delete')).toHaveLength(0);
    });
  });

  describe('destructive (regex fallback)', () => {
    it('catches DELETE FROM x', () => {
      expect(checkRegexDestructive('DELETE FROM users')).toHaveLength(1);
    });

    it('catches TRUNCATE', () => {
      expect(checkRegexDestructive('TRUNCATE users')).toHaveLength(1);
    });
  });

  describe('privilege', () => {
    it('AST: GRANT', () => {
      expect(checkAstPrivilege('grant')).toHaveLength(1);
    });

    it('regex: REVOKE', () => {
      expect(checkRegexPrivilege('REVOKE ALL FROM PUBLIC')).toHaveLength(1);
    });
  });

  describe('DDL', () => {
    it('isDDL identifies DROP/CREATE/ALTER', () => {
      expect(isDDL('drop')).toBe(true);
      expect(isDDL('create')).toBe(true);
      expect(isDDL('alter')).toBe(true);
      expect(isDDL('select')).toBe(false);
    });

    it('checkAstDDL flags DDL operations', () => {
      expect(checkAstDDL('drop')[0].severity).toBe('critical');
    });
  });

  describe('system catalog', () => {
    it('flags pg_authid access', () => {
      expect(checkSystemCatalogAccess('SELECT * FROM pg_authid')).toHaveLength(1);
    });

    it('flags mysql.user', () => {
      expect(checkSystemCatalogAccess('SELECT * FROM mysql.user')).toHaveLength(1);
    });

    it('leaves normal queries alone', () => {
      expect(checkSystemCatalogAccess('SELECT * FROM users')).toHaveLength(0);
    });
  });
});
