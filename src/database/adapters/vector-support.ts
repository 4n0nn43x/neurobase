/**
 * Multi-DB Vector Support Abstraction
 * Provides vector search capabilities across different database engines
 */

import { DatabaseAdapter } from '../adapter';
import { logger } from '../../utils/logger';

export interface VectorSearchResult {
  id: string;
  distance: number;
  data: Record<string, any>;
}

export class VectorSupport {
  private adapter: DatabaseAdapter;
  private dialect: string;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
    this.dialect = adapter.getDialectName();
  }

  /**
   * Initialize vector storage for a table
   */
  async initializeVectorStorage(tableName: string, dimension: number): Promise<void> {
    switch (this.dialect) {
      case 'PostgreSQL':
        await this.initPostgresVector(tableName, dimension);
        break;
      case 'MySQL':
        await this.initMySQLVector(tableName, dimension);
        break;
      case 'SQLite':
        await this.initSQLiteVector(tableName, dimension);
        break;
      case 'MongoDB':
        // MongoDB Atlas Vector Search is configured externally
        logger.info('MongoDB vector search should be configured via Atlas Search indexes');
        break;
      default:
        logger.warn({ dialect: this.dialect }, 'Vector support not available for this dialect');
    }
  }

  /**
   * Search for similar vectors
   */
  async searchSimilar(
    tableName: string,
    queryVector: number[],
    limit: number = 10
  ): Promise<VectorSearchResult[]> {
    switch (this.dialect) {
      case 'PostgreSQL':
        return this.searchPostgres(tableName, queryVector, limit);
      case 'MySQL':
        return this.searchMySQL(tableName, queryVector, limit);
      case 'SQLite':
        return this.searchSQLite(tableName, queryVector, limit);
      case 'MongoDB':
        return this.searchMongoDB(tableName, queryVector, limit);
      default:
        return [];
    }
  }

  /**
   * Store a vector embedding
   */
  async storeVector(tableName: string, id: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
    switch (this.dialect) {
      case 'PostgreSQL':
        await this.adapter.query(
          `UPDATE ${tableName} SET embedding = $1 WHERE id = $2`,
          [`[${vector.join(',')}]`, id]
        );
        break;
      case 'MySQL':
        await this.adapter.query(
          `UPDATE ${tableName} SET embedding = ? WHERE id = ?`,
          [JSON.stringify(vector), id]
        );
        break;
      case 'SQLite':
        await this.adapter.query(
          `UPDATE ${tableName} SET embedding = ? WHERE id = ?`,
          [JSON.stringify(vector), id]
        );
        break;
      case 'MongoDB':
        await this.adapter.query(JSON.stringify({
          collection: tableName,
          updateMany: {
            filter: { _id: id },
            update: { $set: { embedding: vector, ...metadata } },
          },
        }));
        break;
    }
  }

  // PostgreSQL: pgvector + tsvector
  private async initPostgresVector(tableName: string, _dimension: number): Promise<void> {
    await this.adapter.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    // HNSW index for better recall
    try {
      await this.adapter.query(
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_embedding
         ON ${tableName} USING hnsw (embedding vector_cosine_ops)
         WITH (m = 16, ef_construction = 64)`
      );
    } catch (error) {
      logger.warn({ error }, 'Could not create HNSW index, falling back to IVFFlat');
    }
    // Full-text search
    await this.adapter.query(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_fts
       ON ${tableName} USING gin(to_tsvector('english', natural_language))`
    );
  }

  private async searchPostgres(tableName: string, queryVector: number[], limit: number): Promise<VectorSearchResult[]> {
    const vectorStr = `[${queryVector.join(',')}]`;
    const result = await this.adapter.query(
      `SELECT id, embedding <=> $1 AS distance, natural_language, sql
       FROM ${tableName}
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1
       LIMIT $2`,
      [vectorStr, limit]
    );
    return result.rows.map((r: any) => ({
      id: r.id, distance: r.distance, data: { naturalLanguage: r.natural_language, sql: r.sql },
    }));
  }

  // MySQL: JSON array + app-level cosine similarity
  private async initMySQLVector(tableName: string, _dimension: number): Promise<void> {
    // MySQL stores embeddings as JSON
    try {
      await this.adapter.query(
        `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS embedding JSON`
      );
    } catch {
      // Column might already exist
    }
    // Full-text index
    try {
      await this.adapter.query(
        `ALTER TABLE ${tableName} ADD FULLTEXT INDEX idx_${tableName}_ft (natural_language)`
      );
    } catch {
      // Index might already exist
    }
  }

  private async searchMySQL(tableName: string, queryVector: number[], limit: number): Promise<VectorSearchResult[]> {
    // MySQL doesn't have native vector ops, so we fetch candidates and compute similarity in app
    const result = await this.adapter.query(
      `SELECT id, embedding, natural_language, sql FROM ${tableName}
       WHERE embedding IS NOT NULL LIMIT ?`,
      [limit * 10] // Fetch more and filter
    );

    return result.rows
      .map((r: any) => {
        const storedVector = typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding;
        const distance = this.cosineDistance(queryVector, storedVector);
        return { id: r.id, distance, data: { naturalLanguage: r.natural_language, sql: r.sql } };
      })
      .sort((a: VectorSearchResult, b: VectorSearchResult) => a.distance - b.distance)
      .slice(0, limit);
  }

  // SQLite: JSON array + app-level cosine similarity
  private async initSQLiteVector(_tableName: string, _dimension: number): Promise<void> {
    // SQLite stores embeddings as JSON text; FTS5 for text search
    // FTS5 table would need separate creation
  }

  private async searchSQLite(tableName: string, queryVector: number[], limit: number): Promise<VectorSearchResult[]> {
    const result = await this.adapter.query(
      `SELECT id, embedding, natural_language, sql FROM ${tableName}
       WHERE embedding IS NOT NULL LIMIT ?`,
      [limit * 10]
    );

    return result.rows
      .map((r: any) => {
        const storedVector = JSON.parse(r.embedding);
        const distance = this.cosineDistance(queryVector, storedVector);
        return { id: r.id, distance, data: { naturalLanguage: r.natural_language, sql: r.sql } };
      })
      .sort((a: VectorSearchResult, b: VectorSearchResult) => a.distance - b.distance)
      .slice(0, limit);
  }

  // MongoDB: Atlas Vector Search or app-level
  private async searchMongoDB(tableName: string, queryVector: number[], limit: number): Promise<VectorSearchResult[]> {
    // Try Atlas Vector Search first
    try {
      const result = await this.adapter.query(JSON.stringify({
        collection: tableName,
        aggregate: [
          {
            $vectorSearch: {
              index: 'vector_index',
              path: 'embedding',
              queryVector,
              numCandidates: limit * 10,
              limit,
            },
          },
          {
            $project: {
              _id: 1,
              natural_language: 1,
              sql: 1,
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ],
      }));

      return result.rows.map((r: any) => ({
        id: r._id.toString(),
        distance: 1 - (r.score || 0),
        data: { naturalLanguage: r.natural_language, sql: r.sql },
      }));
    } catch {
      // Fallback: fetch and compute in app
      const result = await this.adapter.query(JSON.stringify({
        collection: tableName,
        find: { filter: { embedding: { $exists: true } } },
      }));

      return result.rows
        .map((r: any) => ({
          id: r._id.toString(),
          distance: this.cosineDistance(queryVector, r.embedding),
          data: { naturalLanguage: r.natural_language, sql: r.sql },
        }))
        .sort((a: VectorSearchResult, b: VectorSearchResult) => a.distance - b.distance)
        .slice(0, limit);
    }
  }

  /** Compute cosine distance between two vectors */
  private cosineDistance(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 1;

    let dotProduct = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);

    if (magA === 0 || magB === 0) return 1;

    return 1 - (dotProduct / (magA * magB));
  }
}
