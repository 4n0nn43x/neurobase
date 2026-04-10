/**
 * db-url utilities — covers all four engines (postgresql / mysql / sqlite /
 * mongodb) and the known managed-provider gotchas.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizeDbUrl, validateDbUrlShape, formatDbError } from '../../src/utils/db-url';

// ────────────────────────────────────────────────────────────────────────────
// normalizeDbUrl — encode special chars in the password section
// ────────────────────────────────────────────────────────────────────────────

describe('normalizeDbUrl', () => {
  describe('PostgreSQL', () => {
    it('encodes $ in a Supabase-style password', () => {
      const raw = 'postgresql://postgres:nHj$nZqmzsxbD8a@db.zrwevbevlmtqmkwtpcir.supabase.co:5432/postgres';
      const { normalized, changed } = normalizeDbUrl('postgresql', raw);
      expect(changed).toBe(true);
      expect(normalized).toBe('postgresql://postgres:nHj%24nZqmzsxbD8a@db.zrwevbevlmtqmkwtpcir.supabase.co:5432/postgres');
    });

    it('encodes @ inside the password using the last @ as host separator', () => {
      const raw = 'postgresql://user:p@ssword@host.example.com:5432/db';
      const { normalized, changed } = normalizeDbUrl('postgresql', raw);
      expect(changed).toBe(true);
      expect(normalized).toBe('postgresql://user:p%40ssword@host.example.com:5432/db');
    });

    it('preserves ?sslmode=require query string', () => {
      const raw = 'postgresql://user:p$wd@host:5432/db?sslmode=require';
      const { normalized, changed } = normalizeDbUrl('postgresql', raw);
      expect(changed).toBe(true);
      expect(normalized).toBe('postgresql://user:p%24wd@host:5432/db?sslmode=require');
    });

    it('accepts postgres:// scheme (Heroku/Render style)', () => {
      const raw = 'postgres://u:p$w@host:5432/db';
      const { normalized, changed } = normalizeDbUrl('postgresql', raw);
      expect(changed).toBe(true);
      expect(normalized).toBe('postgres://u:p%24w@host:5432/db');
    });

    it('leaves alphanumeric passwords untouched', () => {
      const raw = 'postgresql://user:abc123@host:5432/db';
      const { normalized, changed } = normalizeDbUrl('postgresql', raw);
      expect(changed).toBe(false);
      expect(normalized).toBe(raw);
    });

    it('does not double-encode an already-encoded password', () => {
      const raw = 'postgresql://user:nHj%24nZ@host:5432/db';
      const { normalized, changed } = normalizeDbUrl('postgresql', raw);
      expect(changed).toBe(false);
    });
  });

  describe('MySQL', () => {
    it('encodes $ in a root password', () => {
      const raw = 'mysql://root:p$$@localhost:3306/app';
      const { normalized, changed } = normalizeDbUrl('mysql', raw);
      expect(changed).toBe(true);
      expect(normalized).toBe('mysql://root:p%24%24@localhost:3306/app');
    });

    it('encodes # and ! (PlanetScale-style passwords)', () => {
      const raw = 'mysql://user:pscale_pw_!#@aws.connect.psdb.cloud:3306/db';
      const { normalized, changed } = normalizeDbUrl('mysql', raw);
      expect(changed).toBe(true);
      expect(normalized).toBe('mysql://user:pscale_pw_!%23@aws.connect.psdb.cloud:3306/db');
    });
  });

  describe('MongoDB', () => {
    it('encodes $ in a vanilla mongodb URL', () => {
      const raw = 'mongodb://user:p$wd@host:27017/db';
      const { normalized, changed } = normalizeDbUrl('mongodb', raw);
      expect(changed).toBe(true);
      expect(normalized).toBe('mongodb://user:p%24wd@host:27017/db');
    });

    it('encodes mongodb+srv:// Atlas connection strings', () => {
      const raw = 'mongodb+srv://user:p@ss@cluster.x1.mongodb.net/db?retryWrites=true';
      const { normalized, changed } = normalizeDbUrl('mongodb', raw);
      expect(changed).toBe(true);
      expect(normalized).toBe('mongodb+srv://user:p%40ss@cluster.x1.mongodb.net/db?retryWrites=true');
    });

    it('handles multi-host mongodb URLs', () => {
      const raw = 'mongodb://user:p$@host1:27017,host2:27017/db';
      const { normalized, changed } = normalizeDbUrl('mongodb', raw);
      expect(changed).toBe(true);
      expect(normalized).toBe('mongodb://user:p%24@host1:27017,host2:27017/db');
    });
  });

  describe('SQLite', () => {
    it('skips file paths (not a URL)', () => {
      const raw = './data/neurobase.db';
      const { normalized, changed } = normalizeDbUrl('sqlite', raw);
      expect(changed).toBe(false);
      expect(normalized).toBe(raw);
    });

    it('skips absolute paths', () => {
      const raw = '/var/lib/neurobase/db.sqlite';
      const { normalized, changed } = normalizeDbUrl('sqlite', raw);
      expect(changed).toBe(false);
      expect(normalized).toBe(raw);
    });
  });

  it('does nothing for a URL without userinfo', () => {
    const raw = 'postgresql://host:5432/db';
    const { normalized, changed } = normalizeDbUrl('postgresql', raw);
    expect(changed).toBe(false);
    expect(normalized).toBe(raw);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// validateDbUrlShape — pre-flight checks
// ────────────────────────────────────────────────────────────────────────────

describe('validateDbUrlShape', () => {
  it('errors on empty url', () => {
    expect(validateDbUrlShape('postgresql', '')?.level).toBe('error');
  });

  it('errors on undefined engine', () => {
    expect(validateDbUrlShape(undefined, 'postgresql://host/db')?.level).toBe('error');
  });

  describe('PostgreSQL', () => {
    it('accepts postgresql:// and postgres://', () => {
      expect(validateDbUrlShape('postgresql', 'postgresql://u:p@h:5432/d')).toBeNull();
      expect(validateDbUrlShape('postgresql', 'postgres://u:p@h:5432/d')).toBeNull();
    });

    it('rejects mysql:// when engine is postgresql', () => {
      const issue = validateDbUrlShape('postgresql', 'mysql://u:p@h:3306/d');
      expect(issue?.level).toBe('error');
      expect(issue?.message).toMatch(/postgresql:\/\//i);
    });
  });

  describe('MySQL', () => {
    it('accepts mysql://', () => {
      expect(validateDbUrlShape('mysql', 'mysql://u:p@h:3306/d')).toBeNull();
    });

    it('rejects scheme mismatch', () => {
      expect(validateDbUrlShape('mysql', 'postgres://u:p@h/d')?.level).toBe('error');
    });
  });

  describe('MongoDB', () => {
    it('accepts mongodb://', () => {
      expect(validateDbUrlShape('mongodb', 'mongodb://h:27017/d')).toBeNull();
    });

    it('accepts mongodb+srv://', () => {
      expect(validateDbUrlShape('mongodb', 'mongodb+srv://cluster.x.mongodb.net/d')).toBeNull();
    });

    it('rejects scheme mismatch', () => {
      expect(validateDbUrlShape('mongodb', 'postgres://h/d')?.level).toBe('error');
    });
  });

  describe('SQLite', () => {
    it('returns null for a writable existing directory', () => {
      const tmp = path.join(os.tmpdir(), `neurobase-test-${Date.now()}.db`);
      expect(validateDbUrlShape('sqlite', tmp)).toBeNull();
    });

    it('warns when parent directory does not exist', () => {
      const bogus = path.join(os.tmpdir(), 'neurobase-test-doesnotexist-' + Date.now(), 'inner', 'db.sqlite');
      const issue = validateDbUrlShape('sqlite', bogus);
      expect(issue?.level).toBe('warn');
      expect(issue?.message).toMatch(/Parent directory does not exist/);
    });
  });

  it('errors when URL has no host', () => {
    const issue = validateDbUrlShape('postgresql', 'postgresql:///db');
    expect(issue?.level).toBe('error');
  });

  it('errors on a clearly garbage URL', () => {
    const issue = validateDbUrlShape('postgresql', 'postgresql://not a url at all');
    expect(issue?.level).toBe('error');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// formatDbError — engine-aware translations + provider hints
// ────────────────────────────────────────────────────────────────────────────

function makeErr(props: Record<string, unknown>): Error {
  const e = new Error(String(props.message ?? 'unknown'));
  Object.assign(e, props);
  return e;
}

describe('formatDbError — DNS layer', () => {
  it('detects Supabase direct-host deprecation', () => {
    const err = makeErr({
      message: 'getaddrinfo ENOTFOUND db.zrwevbevlmtqmkwtpcir.supabase.co',
      code: 'ENOTFOUND',
      hostname: 'db.zrwevbevlmtqmkwtpcir.supabase.co',
    });
    const msg = formatDbError('postgresql', err);
    expect(msg).toMatch(/Connection Pooler/);
    expect(msg).toMatch(/postgres\.zrwevbevlmtqmkwtpcir/);
    expect(msg).toMatch(/pooler\.supabase\.com/);
  });

  it('detects Neon endpoint', () => {
    const err = makeErr({
      message: 'getaddrinfo ENOTFOUND ep-abc.eu-west-1.aws.neon.tech',
      code: 'ENOTFOUND',
      hostname: 'ep-abc.eu-west-1.aws.neon.tech',
    });
    const msg = formatDbError('postgresql', err);
    expect(msg).toMatch(/Neon/i);
    expect(msg).toMatch(/suspended|sleeps/);
  });

  it('detects PlanetScale shutdown for MySQL ENOTFOUND', () => {
    const err = makeErr({
      message: 'getaddrinfo ENOTFOUND aws.connect.psdb.cloud',
      code: 'ENOTFOUND',
      hostname: 'aws.connect.psdb.cloud',
    });
    const msg = formatDbError('mysql', err);
    expect(msg).toMatch(/PlanetScale/i);
    expect(msg).toMatch(/shut down|free/i);
  });

  it('detects MongoDB Atlas SRV failure', () => {
    const err = makeErr({
      message: 'querySrv ENOTFOUND _mongodb._tcp.cluster.xxx.mongodb.net',
      code: 'ENOTFOUND',
      hostname: 'cluster.xxx.mongodb.net',
    });
    const msg = formatDbError('mongodb', err);
    expect(msg).toMatch(/Atlas/i);
  });

  it('falls back to generic ENOTFOUND hint for unknown hosts', () => {
    const err = makeErr({
      message: 'getaddrinfo ENOTFOUND custom.example.com',
      code: 'ENOTFOUND',
      hostname: 'custom.example.com',
    });
    expect(formatDbError('postgresql', err)).toMatch(/host not found.*custom\.example\.com/);
  });
});

describe('formatDbError — transport errors', () => {
  it('explains ETIMEDOUT', () => {
    const err = makeErr({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT', hostname: 'h' });
    expect(formatDbError('postgresql', err)).toMatch(/firewall|IP allow-list/i);
  });

  it('explains ECONNREFUSED', () => {
    const err = makeErr({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });
    expect(formatDbError('mysql', err)).toMatch(/port is closed|server not running/i);
  });
});

describe('formatDbError — auth errors per engine', () => {
  it('PostgreSQL password rejection', () => {
    const err = makeErr({ message: 'password authentication failed for user "postgres"' });
    expect(formatDbError('postgresql', err)).toMatch(/password rejected/i);
  });

  it('PostgreSQL pg_hba.conf', () => {
    const err = makeErr({ message: 'no pg_hba.conf entry for host "1.2.3.4"' });
    expect(formatDbError('postgresql', err)).toMatch(/IP allow-list/i);
  });

  it('PostgreSQL SSL required', () => {
    const err = makeErr({ message: 'SSL connection is required' });
    expect(formatDbError('postgresql', err)).toMatch(/sslmode=require/i);
  });

  it('MySQL access denied', () => {
    const err = makeErr({ message: "Access denied for user 'root'@'1.2.3.4'" });
    expect(formatDbError('mysql', err)).toMatch(/rejected the credentials/i);
  });

  it('MySQL caching_sha2 upgrade hint', () => {
    const err = makeErr({ message: 'ER_NOT_SUPPORTED_AUTH_MODE: server requested unsupported authentication method' });
    expect(formatDbError('mysql', err)).toMatch(/caching_sha2_password/);
  });

  it('SQLite unable to open', () => {
    const err = makeErr({ message: 'SQLITE_CANTOPEN: unable to open database file' });
    expect(formatDbError('sqlite', err)).toMatch(/parent directory exists/i);
  });

  it('SQLite locked', () => {
    const err = makeErr({ message: 'SQLITE_BUSY: database is locked' });
    expect(formatDbError('sqlite', err)).toMatch(/locked/);
  });

  it('MongoDB authentication failed', () => {
    const err = makeErr({ message: 'Authentication failed.' });
    expect(formatDbError('mongodb', err)).toMatch(/authSource/);
  });

  it('MongoDB server selection error', () => {
    const err = makeErr({ name: 'MongoServerSelectionError', message: 'Server selection timed out' });
    expect(formatDbError('mongodb', err)).toMatch(/IP allow-list/i);
  });
});
