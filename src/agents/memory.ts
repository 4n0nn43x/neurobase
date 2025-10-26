/**
 * Memory Agent - Learning and Context Management
 */

import {
  Agent,
  MemoryAgentInput,
  MemoryAgentOutput,
  LearningEntry,
  Correction,
} from '../types';
import { DatabaseConnection } from '../database/connection';
import { BaseLLMProvider } from '../llm';
import { logger } from '../utils/logger';
import { embeddingService } from '../utils/embeddings';
import pgvector from 'pgvector/pg';

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class MemoryAgent implements Agent {
  name = 'MemoryAgent';
  private db: DatabaseConnection;
  // @ts-expect-error - LLM provider reserved for future use
  private _llm: BaseLLMProvider;
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(db: DatabaseConnection, llm: BaseLLMProvider) {
    this.db = db;
    this._llm = llm;
  }

  /**
   * Parse a PostgreSQL vector string to array of numbers
   */
  private parseVector(vectorStr: string): number[] {
    // Remove brackets and split by comma
    return vectorStr
      .substring(1, vectorStr.length - 1)
      .split(',')
      .map((v) => parseFloat(v));
  }

  /**
   * Process memory operations (store, retrieve, update)
   */
  async process(input: MemoryAgentInput): Promise<MemoryAgentOutput> {
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

  /**
   * Store a learning entry
   */
  private async storeEntry(entry: LearningEntry): Promise<MemoryAgentOutput> {
    logger.debug({
      id: entry.id,
      naturalLanguage: entry.naturalLanguage.substring(0, 50),
    }, 'Storing learning entry');

    try {
      // Generate embedding if not provided
      if (!entry.embedding) {
        entry.embedding = await this.generateEmbedding(entry.naturalLanguage);
      }

      // Store in database using pgvector
      await this.db.query(
        `
        INSERT INTO neurobase_learning_history
          (id, natural_language, sql, user_id, timestamp, success, corrected, embedding, context)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          natural_language = EXCLUDED.natural_language,
          sql = EXCLUDED.sql,
          success = EXCLUDED.success,
          corrected = EXCLUDED.corrected,
          embedding = EXCLUDED.embedding,
          context = EXCLUDED.context
      `,
        [
          entry.id,
          entry.naturalLanguage,
          entry.sql,
          entry.userId || null,
          entry.timestamp,
          entry.success,
          entry.corrected,
          entry.embedding ? pgvector.toSql(entry.embedding) : null,
          entry.context ? JSON.stringify(entry.context) : null,
        ]
      );

      // Cache the embedding
      this.embeddingCache.set(entry.naturalLanguage, entry.embedding);

      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to store learning entry');
      return { success: false };
    }
  }

  /**
   * Retrieve similar queries using pgvector semantic search
   */
  private async retrieveSimilar(query: string): Promise<MemoryAgentOutput> {
    logger.debug({
      query: query.substring(0, 50),
    }, 'Retrieving similar queries using hybrid search (pgvector + BM25)');

    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);

      // Hybrid Search using Reciprocal Rank Fusion (RRF)
      // Combines semantic search (pgvector) + keyword search (BM25)
      // This is a Tiger Data Agentic Postgres feature!
      const result = await this.db.query<{
        id: string;
        natural_language: string;
        sql: string;
        user_id: string | null;
        timestamp: Date;
        success: boolean;
        corrected: boolean;
        embedding: string;
        context: string | null;
        combined_score: number;
        vector_rank: number | null;
        keyword_rank: number | null;
      }>(
        `
        WITH vector_search AS (
          -- Semantic search using pgvector
          SELECT
            id,
            ROW_NUMBER() OVER (ORDER BY embedding <=> $1) AS rank
          FROM neurobase_learning_history
          WHERE success = true AND corrected = false AND embedding IS NOT NULL
          ORDER BY embedding <=> $1
          LIMIT 20
        ),
        keyword_search AS (
          -- Keyword search using BM25 (Tiger Data pg_textsearch)
          SELECT
            id,
            ROW_NUMBER() OVER (
              ORDER BY natural_language <@> to_bm25query($2, 'idx_learning_history_bm25')
            ) AS rank
          FROM neurobase_learning_history
          WHERE success = true AND corrected = false
          ORDER BY natural_language <@> to_bm25query($2, 'idx_learning_history_bm25')
          LIMIT 20
        )
        SELECT
          h.id,
          h.natural_language,
          h.sql,
          h.user_id,
          h.timestamp,
          h.success,
          h.corrected,
          h.embedding::text,
          h.context,
          -- Reciprocal Rank Fusion (RRF) formula: combine both scores
          COALESCE(1.0 / (60 + v.rank), 0.0) + COALESCE(1.0 / (60 + k.rank), 0.0) AS combined_score,
          v.rank AS vector_rank,
          k.rank AS keyword_rank
        FROM neurobase_learning_history h
        LEFT JOIN vector_search v ON h.id = v.id
        LEFT JOIN keyword_search k ON h.id = k.id
        WHERE v.id IS NOT NULL OR k.id IS NOT NULL
        ORDER BY combined_score DESC
        LIMIT 5
      `,
        [pgvector.toSql(queryEmbedding), query]
      );

      logger.debug({
        resultsCount: result.rows.length,
        topScore: result.rows[0]?.combined_score,
      }, 'Hybrid search completed');

      const relevantEntries = result.rows.map((row) => ({
        id: row.id,
        naturalLanguage: row.natural_language,
        sql: row.sql,
        userId: row.user_id || undefined,
        timestamp: row.timestamp,
        success: row.success,
        corrected: row.corrected,
        embedding: this.parseVector(row.embedding),
        context: row.context ? JSON.parse(row.context) : undefined,
      }));

      // Filter by combined score threshold
      // RRF scores typically range from 0 to ~0.03, so we use a lower threshold
      const similarQueries = relevantEntries.filter((_, idx) => {
        const score = result.rows[idx].combined_score;
        return score > 0.015; // Threshold for RRF combined score
      });

      logger.debug({
        totalRelevant: relevantEntries.length,
        similarCount: similarQueries.length,
      }, 'Filtered results by RRF score');

      return {
        success: true,
        relevantEntries,
        similarQueries,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to retrieve similar queries with hybrid search');
      return { success: false };
    }
  }

  /**
   * Update an existing entry (e.g., mark as corrected)
   */
  private async updateEntry(entry: LearningEntry): Promise<MemoryAgentOutput> {
    logger.debug({ id: entry.id }, 'Updating learning entry');

    try {
      await this.db.query(
        `
        UPDATE neurobase_learning_history
        SET
          natural_language = $2,
          sql = $3,
          success = $4,
          corrected = $5,
          context = $6
        WHERE id = $1
      `,
        [
          entry.id,
          entry.naturalLanguage,
          entry.sql,
          entry.success,
          entry.corrected,
          entry.context ? JSON.stringify(entry.context) : null,
        ]
      );

      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to update learning entry');
      return { success: false };
    }
  }

  /**
   * Store a correction
   */
  async storeCorrection(correction: Correction): Promise<boolean> {
    logger.debug({
      originalQuery: correction.originalQuery.substring(0, 50),
    }, 'Storing correction');

    try {
      await this.db.query(
        `
        INSERT INTO neurobase_corrections
          (id, original_query, original_sql, corrected_sql, corrected_query, reason, user_id, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [
          uuidv4(),
          correction.originalQuery,
          correction.originalSQL,
          correction.correctedSQL,
          correction.correctedQuery || null,
          correction.reason,
          correction.userId || null,
          correction.timestamp,
        ]
      );

      return true;
    } catch (error) {
      logger.error({ error }, 'Failed to store correction');
      return false;
    }
  }

  /**
   * Get learning history for a user
   */
  async getHistory(
    userId?: string,
    limit: number = 50
  ): Promise<LearningEntry[]> {
    const result = await this.db.query<{
      id: string;
      natural_language: string;
      sql: string;
      user_id: string | null;
      timestamp: Date;
      success: boolean;
      corrected: boolean;
      embedding: string | null;
      context: string | null;
    }>(
      `
      SELECT
        id,
        natural_language,
        sql,
        user_id,
        timestamp,
        success,
        corrected,
        embedding::text,
        context
      FROM neurobase_learning_history
      WHERE ($1::text IS NULL OR user_id = $1)
      ORDER BY timestamp DESC
      LIMIT $2
    `,
      [userId || null, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      naturalLanguage: row.natural_language,
      sql: row.sql,
      userId: row.user_id || undefined,
      timestamp: row.timestamp,
      success: row.success,
      corrected: row.corrected,
      embedding: row.embedding ? this.parseVector(row.embedding) : undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
    }));
  }

  /**
   * Generate embedding for text using local embedding service
   * This is provider-independent and works with any LLM (OpenAI, Claude, Ollama)
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // Check cache first
    if (this.embeddingCache.has(text)) {
      return this.embeddingCache.get(text)!;
    }

    try {
      // Use local embedding service (Transformers.js)
      // This works regardless of which LLM provider is chosen for queries
      const embedding = await embeddingService.generateEmbedding(text);
      this.embeddingCache.set(text, embedding);
      return embedding;
    } catch (error) {
      logger.warn({ error }, 'Failed to generate embedding, using fallback');
      // Fallback: simple hash-based embedding
      return this.fallbackEmbedding(text);
    }
  }

  /**
   * Fallback embedding using simple hashing
   */
  private fallbackEmbedding(text: string): number[] {
    const dimension = 384; // Smaller dimension for fallback
    const embedding = new Array(dimension).fill(0);

    // Simple character-based hashing
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const index = charCode % dimension;
      embedding[index] += 1;
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map((val) => val / (magnitude || 1));
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  // @ts-expect-error - Reserved for future similarity calculations
  private _cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Initialize memory storage tables
   */
  async initializeStorage(): Promise<void> {
    logger.debug('Initializing memory storage tables');

    await this.db.query(`
      -- Enable pgvector extension for semantic search
      CREATE EXTENSION IF NOT EXISTS vector;

      -- Enable pg_textsearch extension for BM25 keyword search (Tiger Data Agentic Postgres)
      CREATE EXTENSION IF NOT EXISTS pg_textsearch;

      -- Learning history table with hybrid search support (pgvector + BM25)
      CREATE TABLE IF NOT EXISTS neurobase_learning_history (
        id TEXT PRIMARY KEY,
        natural_language TEXT NOT NULL,
        sql TEXT NOT NULL,
        user_id TEXT,
        timestamp TIMESTAMP NOT NULL,
        success BOOLEAN NOT NULL DEFAULT true,
        corrected BOOLEAN NOT NULL DEFAULT false,
        embedding vector(384), -- pgvector for embeddings (384 dimensions for all-MiniLM-L6-v2)
        context TEXT -- JSON object
      );

      CREATE INDEX IF NOT EXISTS idx_learning_history_timestamp
        ON neurobase_learning_history(timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_learning_history_user_id
        ON neurobase_learning_history(user_id)
        WHERE user_id IS NOT NULL;

      -- Create vector similarity index for fast semantic search (pgvector)
      CREATE INDEX IF NOT EXISTS idx_learning_history_embedding
        ON neurobase_learning_history
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);

      -- Create BM25 index for keyword search (Tiger Data pg_textsearch)
      CREATE INDEX IF NOT EXISTS idx_learning_history_bm25
        ON neurobase_learning_history
        USING bm25(natural_language)
        WITH (text_config='english');

      CREATE TABLE IF NOT EXISTS neurobase_corrections (
        id TEXT PRIMARY KEY,
        original_query TEXT NOT NULL,
        original_sql TEXT NOT NULL,
        corrected_sql TEXT NOT NULL,
        corrected_query TEXT,
        reason TEXT,
        user_id TEXT,
        timestamp TIMESTAMP NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_corrections_timestamp
        ON neurobase_corrections(timestamp DESC);
    `);

    logger.debug('Memory storage tables initialized');
  }
}
