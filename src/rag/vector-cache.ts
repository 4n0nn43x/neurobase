/**
 * In-Memory Vector Cache
 * Fast approximate nearest neighbor search for recent queries
 * Uses a simple brute-force approach (suitable for ~1000 entries)
 */

import { logger } from '../utils/logger';

export interface CacheEntry {
  id: string;
  embedding: number[];
  naturalLanguage: string;
  sql: string;
  lastAccessed: number;
  accessCount: number;
}

export interface SearchResult {
  id: string;
  naturalLanguage: string;
  sql: string;
  distance: number;
}

export class VectorCache {
  private entries: Map<string, CacheEntry> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Search for similar vectors in cache
   * Returns results sorted by distance (closest first)
   */
  search(queryEmbedding: number[], limit: number = 5, maxDistance: number = 0.5): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      const distance = this.cosineDistance(queryEmbedding, entry.embedding);
      if (distance <= maxDistance) {
        results.push({
          id: entry.id,
          naturalLanguage: entry.naturalLanguage,
          sql: entry.sql,
          distance,
        });
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, limit);
  }

  /**
   * Add or update an entry in the cache
   */
  add(id: string, embedding: number[], naturalLanguage: string, sql: string): void {
    this.entries.set(id, {
      id,
      embedding,
      naturalLanguage,
      sql,
      lastAccessed: Date.now(),
      accessCount: 1,
    });

    // Evict if over capacity
    while (this.entries.size > this.maxSize) {
      this.evictLRU();
    }
  }

  /**
   * Warm up the cache with recent entries from the database
   */
  warmUp(entries: Array<{ id: string; embedding: number[]; naturalLanguage: string; sql: string }>): void {
    logger.debug({ count: entries.length }, 'Warming up vector cache');

    for (const entry of entries) {
      this.add(entry.id, entry.embedding, entry.naturalLanguage, entry.sql);
    }

    logger.debug({ cacheSize: this.entries.size }, 'Vector cache warmed up');
  }

  /**
   * Record a cache hit (updates access time)
   */
  recordHit(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.lastAccessed = Date.now();
      entry.accessCount++;
    }
  }

  /**
   * Remove an entry from cache
   */
  remove(id: string): void {
    this.entries.delete(id);
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  getStats(): { size: number; maxSize: number; avgAccessCount: number } {
    const entries = Array.from(this.entries.values());
    const avgAccessCount = entries.length > 0
      ? entries.reduce((sum, e) => sum + e.accessCount, 0) / entries.length
      : 0;

    return { size: this.entries.size, maxSize: this.maxSize, avgAccessCount };
  }

  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldest = key;
      }
    }

    if (oldest) this.entries.delete(oldest);
  }

  private cosineDistance(a: number[], b: number[]): number {
    if (a.length !== b.length) return 1;

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
