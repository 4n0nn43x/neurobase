/**
 * Memory Agent — learning storage with engine-portable persistence.
 *
 * Strategy:
 *  - PostgreSQL → pgvector + HNSW + GIN FTS, similarity search in the DB
 *    (fast at scale).
 *  - MySQL / SQLite → TEXT-encoded embeddings (JSON array), similarity
 *    computed in-process. Slower above ~50k rows but works everywhere
 *    without driver extensions.
 *  - MongoDB → skipped (a SQL-shaped learning table doesn't fit; users
 *    on Mongo get a clear warn at init time and `enableLearning` is
 *    disabled for that session).
 *
 * Parameter style and upsert syntax are dialect-adapted via `getDialectName()`.
 * Embedding parse / serialize is provided per engine.
 */

import {
  Agent,
  MemoryAgentInput,
  MemoryAgentOutput,
  LearningEntry,
  Correction,
} from '../types';
import { DatabaseAdapter } from '../database/adapter';
import { BaseLLMProvider } from '../llm';
import { logger } from '../utils/logger';
import { embeddingService } from '../utils/embeddings';
import { randomUUID } from 'crypto';

type EngineKey = 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'unknown';

export class MemoryAgent implements Agent {
  name = 'MemoryAgent';
  private db: DatabaseAdapter;
  // @ts-expect-error - LLM provider reserved for future use
  private _llm: BaseLLMProvider;
  private embeddingCache: Map<string, number[]> = new Map();
  private engine: EngineKey = 'unknown';
  private supported = false;
  /** Returns the Nth bound-parameter placeholder for the active engine. */
  private p: (n: number) => string = (n) => `$${n}`;

  constructor(db: DatabaseAdapter, llm: BaseLLMProvider) {
    this.db = db;
    this._llm = llm;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Public surface — dispatches on supported engines and gracefully exits
  // on Mongo / unknown.
  // ────────────────────────────────────────────────────────────────────────

  async process(input: MemoryAgentInput): Promise<MemoryAgentOutput> {
    if (!this.supported) return { success: false };
    const { action, entry, query } = input;
    try {
      switch (action) {
        case 'store':
          if (!entry) throw new Error('Entry required for store action');
          return await this.storeEntry(entry);
        case 'retrieve':
          if (!query) throw new Error('Query required for retrieve action');
          return await this.retrieveSimilar(query);
        case 'update':
          if (!entry) throw new Error('Entry required for update action');
          return await this.updateEntry(entry);
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      logger.error({ action, error }, 'Memory operation failed');
      return { success: false };
    }
  }

  async storeCorrection(correction: Correction): Promise<boolean> {
    if (!this.supported) return false;
    try {
      const p = this.p;
      await this.db.query(
        `INSERT INTO neurobase_corrections
          (id, original_query, original_sql, corrected_sql, corrected_query, reason, user_id, timestamp)
         VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)})`,
        [
          randomUUID(),
          correction.originalQuery,
          correction.originalSQL,
          correction.correctedSQL,
          correction.correctedQuery || null,
          correction.reason,
          correction.userId || null,
          this.timestampLiteral(correction.timestamp),
        ],
      );
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to store correction');
      return false;
    }
  }

  async getHistory(userId?: string, limit: number = 50): Promise<LearningEntry[]> {
    if (!this.supported) return [];
    try {
      const p = this.p;
      // The "(? IS NULL OR user_id = ?)" pattern requires duplicate binding;
      // PG accepts cast-typed nulls. We standardise on duplicate binding so
      // the same statement shape works across engines.
      const result = await this.db.query<{
        id: string;
        natural_language: string;
        sql: string;
        user_id: string | null;
        timestamp: string | Date;
        success: boolean | number;
        corrected: boolean | number;
        embedding: string | null;
        context: string | null;
      }>(
        `SELECT id, natural_language, sql, user_id, timestamp, success, corrected,
                ${this.engine === 'postgresql' ? 'embedding::text AS embedding' : 'embedding'},
                context
         FROM neurobase_learning_history
         WHERE (${this.engine === 'postgresql' ? `${p(1)}::text` : p(1)} IS NULL OR user_id = ${p(2)})
         ORDER BY timestamp DESC
         LIMIT ${p(3)}`,
        [userId || null, userId || null, limit],
      );
      return result.rows.map((row) => this.rowToEntry(row));
    } catch (error) {
      logger.error({ err: error }, 'Failed to get history');
      return [];
    }
  }

  async initializeStorage(): Promise<void> {
    this.engine = this.detectEngine();

    if (this.engine === 'mongodb' || this.engine === 'unknown') {
      logger.warn(
        { engine: this.engine },
        'Memory storage not supported on this engine — learning persistence will no-op',
      );
      this.supported = false;
      return;
    }

    this.p = this.engine === 'postgresql' ? (n: number) => `$${n}` : () => '?';

    try {
      const ddl = this.dialectDdl();
      for (const stmt of ddl) {
        try {
          await this.db.query(stmt);
        } catch (err) {
          // pgvector CREATE EXTENSION and partial indexes (WHERE … IS NOT NULL)
          // can fail without superuser perms or on non-PG engines that don't
          // support them. Log and continue — the main table still works.
          logger.debug({ err, stmt: stmt.slice(0, 80) }, 'Memory DDL statement skipped');
        }
      }
      this.supported = true;
      logger.debug({ engine: this.engine }, 'Memory storage initialized');
    } catch (error) {
      logger.error({ error, engine: this.engine }, 'Failed to initialize memory storage');
      this.supported = false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Internal — engine-aware store/retrieve/update
  // ────────────────────────────────────────────────────────────────────────

  private async storeEntry(entry: LearningEntry): Promise<MemoryAgentOutput> {
    try {
      if (!entry.embedding) {
        entry.embedding = await this.generateEmbedding(entry.naturalLanguage);
      }

      const p = this.p;
      const embeddingLiteral = this.serializeEmbedding(entry.embedding);
      const upsertTail = this.upsertTail();

      await this.db.query(
        `INSERT INTO neurobase_learning_history
          (id, natural_language, sql, user_id, timestamp, success, corrected, embedding, context)
         VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)})
         ${upsertTail}`,
        [
          entry.id,
          entry.naturalLanguage,
          entry.sql,
          entry.userId || null,
          this.timestampLiteral(entry.timestamp),
          this.boolLiteral(entry.success),
          this.boolLiteral(entry.corrected),
          embeddingLiteral,
          entry.context ? JSON.stringify(entry.context) : null,
        ],
      );

      this.embeddingCache.set(entry.naturalLanguage, entry.embedding);
      return { success: true };
    } catch (error) {
      logger.error({ err: error }, 'Failed to store learning entry');
      return { success: false };
    }
  }

  private async retrieveSimilar(query: string): Promise<MemoryAgentOutput> {
    try {
      const queryEmbedding = await this.generateEmbedding(query);

      if (this.engine === 'postgresql') {
        return await this.retrieveSimilarPg(queryEmbedding);
      }
      return await this.retrieveSimilarInProcess(queryEmbedding);
    } catch (error) {
      logger.error({ err: error }, 'Failed to retrieve similar queries');
      return { success: false };
    }
  }

  /** PostgreSQL fast path — pgvector cosine distance in the DB. */
  private async retrieveSimilarPg(queryEmbedding: number[]): Promise<MemoryAgentOutput> {
    const result = await this.db.query<{
      id: string; natural_language: string; sql: string;
      user_id: string | null; timestamp: Date;
      success: boolean; corrected: boolean;
      embedding: string; context: string | null;
      distance: number;
    }>(
      `SELECT id, natural_language, sql, user_id, timestamp, success, corrected,
              embedding::text, context,
              embedding <=> $1 AS distance
       FROM neurobase_learning_history
       WHERE success = true AND corrected = false AND embedding IS NOT NULL
       ORDER BY embedding <=> $1
       LIMIT 10`,
      [this.serializeEmbedding(queryEmbedding)],
    );

    const relevantEntries = result.rows.map((row) => this.rowToEntry(row));
    const similarQueries = relevantEntries.filter((_, idx) => result.rows[idx].distance < 0.5);
    return { success: true, relevantEntries, similarQueries };
  }

  /**
   * Portable path — load N most recent succeeded entries, compute cosine
   * similarity in memory, return top 10. O(N) per query; fine up to ~50k
   * rows. Beyond that, a real vector store (or pgvector) is recommended.
   */
  private async retrieveSimilarInProcess(queryEmbedding: number[]): Promise<MemoryAgentOutput> {
    const p = this.p;
    const result = await this.db.query<{
      id: string; natural_language: string; sql: string;
      user_id: string | null; timestamp: string | Date;
      success: boolean | number; corrected: boolean | number;
      embedding: string | null; context: string | null;
    }>(
      `SELECT id, natural_language, sql, user_id, timestamp, success, corrected, embedding, context
       FROM neurobase_learning_history
       WHERE success = ${this.engine === 'sqlite' ? '1' : 'true'}
         AND corrected = ${this.engine === 'sqlite' ? '0' : 'false'}
         AND embedding IS NOT NULL
       ORDER BY timestamp DESC
       LIMIT ${p(1)}`,
      [1000],
    );

    const scored = result.rows.map((row) => {
      const emb = row.embedding ? this.parseEmbedding(row.embedding) : null;
      const distance = emb ? 1 - this.cosineSimilarity(queryEmbedding, emb) : 1;
      return { row, distance };
    });
    scored.sort((a, b) => a.distance - b.distance);
    const top = scored.slice(0, 10);

    const relevantEntries = top.map((s) => this.rowToEntry(s.row));
    const similarQueries = relevantEntries.filter((_, idx) => top[idx].distance < 0.5);
    return { success: true, relevantEntries, similarQueries };
  }

  private async updateEntry(entry: LearningEntry): Promise<MemoryAgentOutput> {
    try {
      const p = this.p;
      await this.db.query(
        `UPDATE neurobase_learning_history
         SET natural_language = ${p(2)},
             sql = ${p(3)},
             success = ${p(4)},
             corrected = ${p(5)},
             context = ${p(6)}
         WHERE id = ${p(1)}`,
        [
          entry.id,
          entry.naturalLanguage,
          entry.sql,
          this.boolLiteral(entry.success),
          this.boolLiteral(entry.corrected),
          entry.context ? JSON.stringify(entry.context) : null,
        ],
      );
      return { success: true };
    } catch (error) {
      logger.error({ err: error }, 'Failed to update learning entry');
      return { success: false };
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Embedding helpers
  // ────────────────────────────────────────────────────────────────────────

  private async generateEmbedding(text: string): Promise<number[]> {
    if (this.embeddingCache.has(text)) return this.embeddingCache.get(text)!;
    try {
      const embedding = await embeddingService.generateEmbedding(text);
      this.embeddingCache.set(text, embedding);
      return embedding;
    } catch (error) {
      logger.warn({ error }, 'Failed to generate embedding, using fallback');
      return this.fallbackEmbedding(text);
    }
  }

  private fallbackEmbedding(text: string): number[] {
    const dimension = 384;
    const embedding = new Array(dimension).fill(0);
    for (let i = 0; i < text.length; i++) {
      embedding[text.charCodeAt(i) % dimension] += 1;
    }
    const magnitude = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    return embedding.map((v) => v / (magnitude || 1));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  /** Serialise an embedding for the active engine. */
  private serializeEmbedding(vector: number[]): string {
    if (this.engine === 'postgresql') return `[${vector.join(',')}]`;
    return JSON.stringify(vector);
  }

  /** Parse a stored embedding back into number[] regardless of engine. */
  private parseEmbedding(raw: string): number[] {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1);
      if (!inner) return [];
      return inner.split(',').map((v) => parseFloat(v));
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Engine helpers — DDL, parameter style, type literals
  // ────────────────────────────────────────────────────────────────────────

  private detectEngine(): EngineKey {
    const name = (this.db.getDialectName?.() ?? '').toLowerCase();
    if (name.includes('postgres')) return 'postgresql';
    if (name.includes('mysql') || name.includes('maria')) return 'mysql';
    if (name.includes('sqlite')) return 'sqlite';
    if (name.includes('mongo')) return 'mongodb';
    return 'unknown';
  }

  private dialectDdl(): string[] {
    if (this.engine === 'postgresql') {
      return [
        `CREATE EXTENSION IF NOT EXISTS vector`,
        `CREATE TABLE IF NOT EXISTS neurobase_learning_history (
          id TEXT PRIMARY KEY,
          natural_language TEXT NOT NULL,
          sql TEXT NOT NULL,
          user_id TEXT,
          timestamp TIMESTAMP NOT NULL,
          success BOOLEAN NOT NULL DEFAULT true,
          corrected BOOLEAN NOT NULL DEFAULT false,
          embedding vector(384),
          context TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS idx_learning_history_timestamp ON neurobase_learning_history(timestamp DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_learning_history_user_id ON neurobase_learning_history(user_id) WHERE user_id IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS idx_learning_history_embedding ON neurobase_learning_history USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`,
        `CREATE INDEX IF NOT EXISTS idx_learning_history_fts ON neurobase_learning_history USING gin(to_tsvector('english', natural_language))`,
        `CREATE TABLE IF NOT EXISTS neurobase_corrections (
          id TEXT PRIMARY KEY,
          original_query TEXT NOT NULL,
          original_sql TEXT NOT NULL,
          corrected_sql TEXT NOT NULL,
          corrected_query TEXT,
          reason TEXT,
          user_id TEXT,
          timestamp TIMESTAMP NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_corrections_timestamp ON neurobase_corrections(timestamp DESC)`,
      ];
    }

    if (this.engine === 'mysql') {
      return [
        `CREATE TABLE IF NOT EXISTS neurobase_learning_history (
          id VARCHAR(64) PRIMARY KEY,
          natural_language TEXT NOT NULL,
          sql_text TEXT NOT NULL,
          user_id VARCHAR(128),
          timestamp DATETIME(3) NOT NULL,
          success BOOLEAN NOT NULL DEFAULT TRUE,
          corrected BOOLEAN NOT NULL DEFAULT FALSE,
          embedding LONGTEXT,
          context TEXT
        )`,
        `CREATE INDEX idx_learning_history_timestamp ON neurobase_learning_history(timestamp)`,
        `CREATE INDEX idx_learning_history_user_id ON neurobase_learning_history(user_id)`,
        `CREATE TABLE IF NOT EXISTS neurobase_corrections (
          id VARCHAR(64) PRIMARY KEY,
          original_query TEXT NOT NULL,
          original_sql TEXT NOT NULL,
          corrected_sql TEXT NOT NULL,
          corrected_query TEXT,
          reason TEXT,
          user_id VARCHAR(128),
          timestamp DATETIME(3) NOT NULL
        )`,
        `CREATE INDEX idx_corrections_timestamp ON neurobase_corrections(timestamp)`,
      ];
    }

    // SQLite
    return [
      `CREATE TABLE IF NOT EXISTS neurobase_learning_history (
        id TEXT PRIMARY KEY,
        natural_language TEXT NOT NULL,
        sql TEXT NOT NULL,
        user_id TEXT,
        timestamp TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 1,
        corrected INTEGER NOT NULL DEFAULT 0,
        embedding TEXT,
        context TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_learning_history_timestamp ON neurobase_learning_history(timestamp DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_learning_history_user_id ON neurobase_learning_history(user_id)`,
      `CREATE TABLE IF NOT EXISTS neurobase_corrections (
        id TEXT PRIMARY KEY,
        original_query TEXT NOT NULL,
        original_sql TEXT NOT NULL,
        corrected_sql TEXT NOT NULL,
        corrected_query TEXT,
        reason TEXT,
        user_id TEXT,
        timestamp TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_corrections_timestamp ON neurobase_corrections(timestamp DESC)`,
    ];
  }

  /** Upsert tail appended to INSERT — engine-specific syntax. */
  private upsertTail(): string {
    if (this.engine === 'postgresql') {
      return `ON CONFLICT (id) DO UPDATE SET
        natural_language = EXCLUDED.natural_language,
        sql = EXCLUDED.sql,
        success = EXCLUDED.success,
        corrected = EXCLUDED.corrected,
        embedding = EXCLUDED.embedding,
        context = EXCLUDED.context`;
    }
    if (this.engine === 'mysql') {
      return `ON DUPLICATE KEY UPDATE
        natural_language = VALUES(natural_language),
        sql_text = VALUES(sql_text),
        success = VALUES(success),
        corrected = VALUES(corrected),
        embedding = VALUES(embedding),
        context = VALUES(context)`;
    }
    // SQLite uses ON CONFLICT too (3.24+) which all modern installs ship.
    return `ON CONFLICT(id) DO UPDATE SET
      natural_language = excluded.natural_language,
      sql = excluded.sql,
      success = excluded.success,
      corrected = excluded.corrected,
      embedding = excluded.embedding,
      context = excluded.context`;
  }

  /** Timestamp binding — Date for PG/MySQL drivers, ISO string for SQLite. */
  private timestampLiteral(d: Date): Date | string {
    if (this.engine === 'sqlite') return d.toISOString();
    return d;
  }

  /** Boolean binding — 0/1 for SQLite, native boolean elsewhere. */
  private boolLiteral(v: boolean): boolean | number {
    return this.engine === 'sqlite' ? (v ? 1 : 0) : v;
  }

  private rowToEntry(row: {
    id: string;
    natural_language: string;
    sql: string;
    user_id: string | null;
    timestamp: string | Date;
    success: boolean | number;
    corrected: boolean | number;
    embedding: string | null;
    context: string | null;
  }): LearningEntry {
    return {
      id: row.id,
      naturalLanguage: row.natural_language,
      sql: row.sql,
      userId: row.user_id || undefined,
      timestamp: typeof row.timestamp === 'string' ? new Date(row.timestamp) : row.timestamp,
      success: !!row.success,
      corrected: !!row.corrected,
      embedding: row.embedding ? this.parseEmbedding(row.embedding) : undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
    };
  }
}
