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
  private llm: BaseLLMProvider;
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(db: DatabaseConnection, llm: BaseLLMProvider) {
    this.db = db;
    this.llm = llm;
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
      logger.error('Memory operation failed', { action, error });
      return { success: false };
    }
  }

  /**
   * Store a learning entry
   */
  private async storeEntry(entry: LearningEntry): Promise<MemoryAgentOutput> {
    logger.info('Storing learning entry', {
      id: entry.id,
      naturalLanguage: entry.naturalLanguage.substring(0, 50),
    });

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
      logger.error('Failed to store learning entry', { error });
      return { success: false };
    }
  }

  /**
   * Retrieve similar queries using pgvector semantic search
   */
  private async retrieveSimilar(query: string): Promise<MemoryAgentOutput> {
    logger.info('Retrieving similar queries', {
      query: query.substring(0, 50),
    });

    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);

      // Use pgvector for efficient similarity search with cosine distance
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
        similarity: number;
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
          context,
          1 - (embedding <=> $1) as similarity
        FROM neurobase_learning_history
        WHERE success = true AND corrected = false AND embedding IS NOT NULL
        ORDER BY embedding <=> $1
        LIMIT 5
      `,
        [pgvector.toSql(queryEmbedding)]
      );

      const relevantEntries = result.rows.map((row) => ({
        id: row.id,
        naturalLanguage: row.natural_language,
        sql: row.sql,
        userId: row.user_id || undefined,
        timestamp: row.timestamp,
        success: row.success,
        corrected: row.corrected,
        embedding: pgvector.fromSql(row.embedding),
        context: row.context ? JSON.parse(row.context) : undefined,
      }));

      // Filter by similarity threshold (> 0.7)
      const similarQueries = relevantEntries.filter((_, idx) => {
        const similarity = result.rows[idx].similarity;
        return similarity > 0.7;
      });

      return {
        success: true,
        relevantEntries,
        similarQueries,
      };
    } catch (error) {
      logger.error('Failed to retrieve similar queries', { error });
      return { success: false };
    }
  }

  /**
   * Update an existing entry (e.g., mark as corrected)
   */
  private async updateEntry(entry: LearningEntry): Promise<MemoryAgentOutput> {
    logger.info('Updating learning entry', { id: entry.id });

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
      logger.error('Failed to update learning entry', { error });
      return { success: false };
    }
  }

  /**
   * Store a correction
   */
  async storeCorrection(correction: Correction): Promise<boolean> {
    logger.info('Storing correction', {
      originalQuery: correction.originalQuery.substring(0, 50),
    });

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
      logger.error('Failed to store correction', { error });
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
      embedding: row.embedding ? pgvector.fromSql(row.embedding) : undefined,
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
      logger.warn('Failed to generate embedding, using fallback', { error });
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
  private cosineSimilarity(a: number[], b: number[]): number {
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
    logger.info('Initializing memory storage tables');

    await this.db.query(`
      -- Enable pgvector extension
      CREATE EXTENSION IF NOT EXISTS vector;

      -- Learning history table with pgvector support
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

      -- Create vector similarity index for fast semantic search
      CREATE INDEX IF NOT EXISTS idx_learning_history_embedding
        ON neurobase_learning_history
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);

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

    logger.info('Memory storage tables initialized');
  }
}
