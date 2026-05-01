/**
 * Credential store — round-trip + isolation per provider.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'neurobase-cred-test-'));
const origNeurobaseHome = process.env.NEUROBASE_HOME;
process.env.NEUROBASE_HOME = path.join(tmpHome, '.neurobase');

import {
  getCredential, setCredential, removeCredential, listConfiguredProviders, maskKey,
} from '../../src/config/credential-store';

afterAll(() => {
  if (origNeurobaseHome === undefined) delete process.env.NEUROBASE_HOME;
  else process.env.NEUROBASE_HOME = origNeurobaseHome;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  const dir = process.env.NEUROBASE_HOME!;
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('credential round-trip', () => {
  it('returns null when nothing is stored', () => {
    expect(getCredential('anthropic')).toBeNull();
  });

  it('persists and reads back a key', () => {
    setCredential('anthropic', 'sk-ant-test-123');
    expect(getCredential('anthropic')).toBe('sk-ant-test-123');
  });

  it('overwrites an existing key on second set', () => {
    setCredential('openai', 'sk-old');
    setCredential('openai', 'sk-new');
    expect(getCredential('openai')).toBe('sk-new');
  });

  it('isolates providers from each other', () => {
    setCredential('anthropic', 'sk-ant-x');
    setCredential('openai', 'sk-y');
    setCredential('openrouter', 'sk-or-z');
    expect(getCredential('anthropic')).toBe('sk-ant-x');
    expect(getCredential('openai')).toBe('sk-y');
    expect(getCredential('openrouter')).toBe('sk-or-z');
  });

  it('removeCredential drops the entry but leaves others alone', () => {
    setCredential('anthropic', 'a');
    setCredential('openai', 'b');
    removeCredential('anthropic');
    expect(getCredential('anthropic')).toBeNull();
    expect(getCredential('openai')).toBe('b');
  });

  it('listConfiguredProviders returns only providers with stored keys', () => {
    setCredential('anthropic', 'a');
    setCredential('openrouter', 'c');
    const list = listConfiguredProviders().sort();
    expect(list).toEqual(['anthropic', 'openrouter']);
  });
});

describe('maskKey', () => {
  it('masks an empty key as empty', () => {
    expect(maskKey('')).toBe('');
  });

  it('hides short keys entirely', () => {
    expect(maskKey('abc')).toBe('***');
  });

  it('keeps the first 7 and last 4 characters for longer keys', () => {
    expect(maskKey('sk-ant-api03-abcdefghijk-XYZ123')).toBe('sk-ant-...Z123');
  });
});
