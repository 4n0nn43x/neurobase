/**
 * Embedding service using Transformers.js for local, provider-independent embeddings
 */

import { pipeline, Pipeline } from '@xenova/transformers';
import { logger } from './logger';

export class EmbeddingService {
  private static instance: EmbeddingService;
  private embedder: Pipeline | null = null;
  private initialized = false;
  private dimension = 384; // Default dimension for all-MiniLM-L6-v2

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Initialize the embedding model
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      logger.info('Initializing local embedding model (all-MiniLM-L6-v2)...');

      // Use a lightweight, high-quality embedding model
      // all-MiniLM-L6-v2: 384 dimensions, fast, good quality
      this.embedder = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2'
      );

      this.initialized = true;
      logger.info('Local embedding model initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize embedding model', { error });
      throw new Error(`Embedding initialization failed: ${error}`);
    }
  }

  /**
   * Generate embedding for text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.initialized || !this.embedder) {
      await this.initialize();
    }

    try {
      // Generate embedding
      const output = await this.embedder!(text, {
        pooling: 'mean',
        normalize: true,
      });

      // Extract the embedding array
      const embedding = Array.from(output.data as Float32Array);

      return embedding;
    } catch (error) {
      logger.error('Failed to generate embedding', { error, textLength: text.length });

      // Fallback: simple hash-based embedding
      logger.warn('Using fallback hash-based embedding');
      return this.fallbackEmbedding(text);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch processing)
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (const text of texts) {
      const embedding = await this.generateEmbedding(text);
      embeddings.push(embedding);
    }

    return embeddings;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
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
   * Find most similar texts from a list
   */
  async findMostSimilar(
    query: string,
    candidates: Array<{ text: string; embedding?: number[] }>,
    topK: number = 5
  ): Promise<Array<{ text: string; similarity: number; index: number }>> {
    const queryEmbedding = await this.generateEmbedding(query);

    const results = await Promise.all(
      candidates.map(async (candidate, index) => {
        const candidateEmbedding =
          candidate.embedding || (await this.generateEmbedding(candidate.text));

        const similarity = this.cosineSimilarity(queryEmbedding, candidateEmbedding);

        return {
          text: candidate.text,
          similarity,
          index,
        };
      })
    );

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    // Return top K
    return results.slice(0, topK);
  }

  /**
   * Get embedding dimension
   */
  getDimension(): number {
    return this.dimension;
  }

  /**
   * Fallback embedding using simple hashing (for errors)
   */
  private fallbackEmbedding(text: string): number[] {
    const embedding = new Array(this.dimension).fill(0);

    // Simple character-based hashing
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const index = charCode % this.dimension;
      embedding[index] += 1;
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map((val) => val / (magnitude || 1));
  }
}

// Export singleton instance
export const embeddingService = EmbeddingService.getInstance();
