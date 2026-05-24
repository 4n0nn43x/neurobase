/**
 * Credential store — keeps API keys and service secrets out of profiles/.env
 *
 * Layout: ~/.neurobase/credentials.json (chmod 600)
 *
 * Schema:
 *   {
 *     "anthropic": "sk-ant-...",
 *     "openai":    "sk-...",
 *     "openrouter":"sk-or-...",
 *     "multiagent_token": "<64 hex chars>"
 *   }
 *
 * Stored in plaintext today; designed so the file can later be swapped for an
 * OS keychain backend (Keychain on macOS, Credential Manager on Windows, libsecret
 * on Linux) without changing callers. The file is created with 0600 permissions
 * on POSIX so other local users cannot read it.
 *
 * Two surfaces:
 *  - Typed LLM-provider API: getCredential / setCredential / listConfiguredProviders
 *  - Generic API: getSecret / setSecret / hasSecret for arbitrary internal keys
 *    (multi-agent token, future webhook secrets, etc.)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';

export type CredentialProvider = 'anthropic' | 'openai' | 'openrouter';

function getNeurobaseHome(): string {
  return process.env.NEUROBASE_HOME || path.join(os.homedir(), '.neurobase');
}

function getStoreFile(): string {
  return path.join(getNeurobaseHome(), 'credentials.json');
}

function readStore(): Record<string, string> {
  const file = getStoreFile();
  if (!fs.existsSync(file)) return {};
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, string>): void {
  const file = getStoreFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  // Best-effort chmod 600 (no-op on Windows; harmless if it fails)
  try {
    fs.chmodSync(file, 0o600);
  } catch { /* ignore */ }
}

export function getCredential(provider: CredentialProvider): string | null {
  const store = readStore();
  return (provider in store) ? store[provider] : null;
}

export function setCredential(provider: CredentialProvider, key: string): void {
  const store = readStore();
  store[provider] = key;
  writeStore(store);
}

export function removeCredential(provider: CredentialProvider): boolean {
  const store = readStore();
  if (!(provider in store)) return false;
  delete store[provider];
  writeStore(store);
  return true;
}

export function listConfiguredProviders(): CredentialProvider[] {
  const store = readStore();
  return Object.keys(store).filter(
    (k): k is CredentialProvider => k === 'anthropic' || k === 'openai' || k === 'openrouter',
  );
}

/**
 * Mask a key for display: keep first 7 + last 4 characters, fill middle with dots.
 * sk-ant-api03-abc...XYZ
 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return '*'.repeat(key.length);
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic secret API — for internal app secrets (multi-agent token, etc.)
// LLM-provider keys go through the typed surface above so call-sites stay
// readable.
// ─────────────────────────────────────────────────────────────────────────────

export function getSecret(key: string): string | null {
  const store = readStore();
  return (key in store) ? store[key] : null;
}

export function setSecret(key: string, value: string): void {
  const store = readStore();
  store[key] = value;
  writeStore(store);
}

export function hasSecret(key: string): boolean {
  return getSecret(key) !== null;
}

export function removeSecret(key: string): boolean {
  const store = readStore();
  if (!(key in store)) return false;
  delete store[key];
  writeStore(store);
  return true;
}

/**
 * Resolve the multi-agent bearer token with auto-generation.
 *
 * Resolution order:
 *  1. process.env.NEUROBASE_MULTIAGENT_TOKEN (override path for CI / containers)
 *  2. credentials.json `multiagent_token` (the normal path)
 *  3. Generate a new 32-byte hex token, persist it, return it.
 *
 * Returns `{ token, generated }` so callers can show a one-time message
 * the first time the token is created.
 */
export function ensureMultiAgentToken(): { token: string; generated: boolean } {
  const fromEnv = process.env.NEUROBASE_MULTIAGENT_TOKEN;
  if (fromEnv) {
    // Honor the operator's explicit value regardless of length, but warn so
    // they know the token will be used as-is (short tokens are weak).
    if (fromEnv.length < 32) {
      process.stderr.write(
        `[neurobase] WARNING: NEUROBASE_MULTIAGENT_TOKEN is set but only ${fromEnv.length} characters long ` +
        `(minimum recommended: 32). Using it as-is — consider a stronger value.\n`,
      );
    }
    return { token: fromEnv, generated: false };
  }

  const existing = getSecret('multiagent_token');
  if (existing && existing.length >= 32) {
    return { token: existing, generated: false };
  }

  const fresh = randomBytes(32).toString('hex');
  setSecret('multiagent_token', fresh);
  return { token: fresh, generated: true };
}
