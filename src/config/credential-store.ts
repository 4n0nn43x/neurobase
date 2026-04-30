/**
 * Credential store — keeps API keys out of profiles/.env
 *
 * Layout: ~/.neurobase/credentials.json (chmod 600)
 *
 * Schema:
 *   {
 *     "anthropic": "sk-ant-...",
 *     "openai":    "sk-...",
 *     "openrouter":"sk-or-..."
 *   }
 *
 * Stored in plaintext today; designed so the file can later be swapped for an
 * OS keychain backend (Keychain on macOS, Credential Manager on Windows, libsecret
 * on Linux) without changing callers. The file is created with 0600 permissions
 * on POSIX so other local users cannot read it.
 *
 * The store is intentionally minimal: getCredential / setCredential / removeCredential.
 * No encryption-at-rest yet — that needs a master password flow, tracked as future work.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
  return store[provider] || null;
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
