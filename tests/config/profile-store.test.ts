/**
 * Profile store + database registry helpers.
 *
 * Tests use a temp HOME so writes don't touch the developer's
 * ~/.neurobase/ directory.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'neurobase-profile-test-'));
const origNeurobaseHome = process.env.NEUROBASE_HOME;
process.env.NEUROBASE_HOME = path.join(tmpHome, '.neurobase');

import {
  loadProfile, saveProfile, deleteProfile, listProfiles,
  getActiveProfileName, setActiveProfile,
  addDatabase, removeDatabase, setActiveDatabase, listDatabases, getActiveDatabase,
} from '../../src/config/profile-store';

afterAll(() => {
  if (origNeurobaseHome === undefined) delete process.env.NEUROBASE_HOME;
  else process.env.NEUROBASE_HOME = origNeurobaseHome;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  const dir = process.env.NEUROBASE_HOME!;
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('saveProfile + loadProfile', () => {
  it('round-trips a simple profile', () => {
    saveProfile('default', {
      llm: { provider: 'anthropic', anthropic: { model: 'claude-sonnet-4-5' } },
      security: { privacyMode: 'schema-only' },
    });
    const loaded = loadProfile('default');
    expect(loaded?.llm?.provider).toBe('anthropic');
    expect(loaded?.security?.privacyMode).toBe('schema-only');
    expect(loaded?.version).toBe(1);
    expect(loaded?.createdAt).toBeTruthy();
    expect(loaded?.updatedAt).toBeTruthy();
  });

  it('returns null for an unknown profile', () => {
    expect(loadProfile('nonexistent')).toBeNull();
  });

  it('updatedAt advances on second save', async () => {
    saveProfile('default', { llm: { provider: 'openai' } });
    const first = loadProfile('default')!;
    await new Promise((r) => setTimeout(r, 10));
    saveProfile('default', { llm: { provider: 'anthropic' } });
    const second = loadProfile('default')!;
    expect(second.createdAt).toBe(first.createdAt);
    expect(new Date(second.updatedAt).getTime()).toBeGreaterThan(new Date(first.updatedAt).getTime());
  });
});

describe('active profile selector', () => {
  it('defaults to "default" when nothing is set', () => {
    expect(getActiveProfileName()).toBe('default');
  });

  it('persists the active selection', () => {
    setActiveProfile('prod');
    expect(getActiveProfileName()).toBe('prod');
  });
});

describe('listProfiles / deleteProfile', () => {
  it('lists every saved profile alphabetically', () => {
    saveProfile('zeta', {});
    saveProfile('alpha', {});
    saveProfile('beta', {});
    const list = listProfiles().sort();
    expect(list).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('removes a profile from disk', () => {
    saveProfile('disposable', {});
    expect(loadProfile('disposable')).not.toBeNull();
    deleteProfile('disposable');
    expect(loadProfile('disposable')).toBeNull();
  });
});

describe('database registry', () => {
  beforeEach(() => {
    saveProfile('default', {
      llm: { provider: 'anthropic', anthropic: { model: 'claude-sonnet-4-5' } },
    });
  });

  it('addDatabase creates entry and sets it active when first added', () => {
    addDatabase('default', 'prod', {
      engine: 'postgresql',
      connectionString: 'postgresql://u:p@h:5432/db',
    });
    const p = loadProfile('default')!;
    expect(p.databases?.prod).toBeDefined();
    expect(p.activeDatabase).toBe('prod');
  });

  it('addDatabase keeps active when subsequent DBs are added', () => {
    addDatabase('default', 'prod', { engine: 'postgresql', connectionString: 'a' });
    addDatabase('default', 'sandbox', { engine: 'sqlite', connectionString: './x.db' });
    expect(loadProfile('default')!.activeDatabase).toBe('prod');
  });

  it('setActiveDatabase switches the pointer', () => {
    addDatabase('default', 'prod', { engine: 'postgresql', connectionString: 'a' });
    addDatabase('default', 'sandbox', { engine: 'sqlite', connectionString: './x.db' });
    setActiveDatabase('default', 'sandbox');
    expect(loadProfile('default')!.activeDatabase).toBe('sandbox');
  });

  it('setActiveDatabase returns null for unknown name', () => {
    addDatabase('default', 'prod', { engine: 'postgresql', connectionString: 'a' });
    expect(setActiveDatabase('default', 'ghost')).toBeNull();
  });

  it('removeDatabase reassigns active when the active one is removed', () => {
    addDatabase('default', 'a', { engine: 'postgresql', connectionString: 'a' });
    addDatabase('default', 'b', { engine: 'mysql', connectionString: 'b' });
    setActiveDatabase('default', 'a');
    removeDatabase('default', 'a');
    const p = loadProfile('default')!;
    expect(p.databases?.a).toBeUndefined();
    expect(p.activeDatabase).toBe('b');
  });

  it('listDatabases returns names sorted', () => {
    addDatabase('default', 'zeta', { engine: 'postgresql', connectionString: 'z' });
    addDatabase('default', 'alpha', { engine: 'postgresql', connectionString: 'a' });
    addDatabase('default', 'mu', { engine: 'postgresql', connectionString: 'm' });
    const names = listDatabases(loadProfile('default')).map((d) => d.name);
    expect(names).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('getActiveDatabase falls back to legacy single-DB slot when registry is empty', () => {
    saveProfile('legacy', {
      database: { engine: 'postgresql', connectionString: 'postgresql://legacy/db' },
    });
    const active = getActiveDatabase(loadProfile('legacy'));
    expect(active?.engine).toBe('postgresql');
    expect(active?.connectionString).toBe('postgresql://legacy/db');
  });

  it('getActiveDatabase prefers the registry over the legacy slot', () => {
    saveProfile('mixed', {
      database: { engine: 'postgresql', connectionString: 'legacy' },
    });
    addDatabase('mixed', 'new', { engine: 'mysql', connectionString: 'fresh' });
    setActiveDatabase('mixed', 'new');
    const active = getActiveDatabase(loadProfile('mixed'));
    expect(active?.engine).toBe('mysql');
    expect(active?.connectionString).toBe('fresh');
  });
});
