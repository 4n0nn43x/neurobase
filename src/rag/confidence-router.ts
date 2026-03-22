/**
 * Confidence-based RAG Router
 * Routes queries through different tiers based on confidence scores
 */

import { logger } from '../utils/logger';

export interface RouteResult {
  tier: 1 | 2 | 3 | 4;
  tierName: string;
  cachedSQL?: string;
  examples?: Array<{ naturalLanguage: string; sql: string }>;
  confidence: number;
}

export interface CachedQuery {
  naturalLanguage: string;
  sql: string;
  confidence: number;
  lastUsed: Date;
  useCount: number;
}

export class ConfidenceRouter {
  private cache: Map<string, CachedQuery> = new Map();
  private maxCacheSize = 1000;

  // Tier thresholds
  private tier1Threshold = 0.95; // Direct cache hit
  private tier2Threshold = 0.80; // Few-shot with examples
  private tier3Threshold = 0.50; // Full pipeline with schema + history

  /**
   * Route a query through the appropriate tier
   */
  async route(
    query: string,
    similarQueries?: Array<{ naturalLanguage: string; sql: string; confidence?: number }>
  ): Promise<RouteResult> {
    // Tier 1: Check exact/near-exact cache
    const cacheKey = this.normalizeQuery(query);
    const cached = this.cache.get(cacheKey);

    if (cached && cached.confidence >= this.tier1Threshold) {
      cached.lastUsed = new Date();
      cached.useCount++;
      logger.debug({ tier: 1, query: query.substring(0, 50) }, 'Tier 1: Cache hit');
      return {
        tier: 1,
        tierName: 'cache-direct',
        cachedSQL: cached.sql,
        confidence: cached.confidence,
      };
    }

    // Tier 2: Check for high-similarity matches
    if (similarQueries && similarQueries.length > 0) {
      const topMatch = similarQueries[0];
      const similarity = topMatch.confidence || this.computeTextSimilarity(query, topMatch.naturalLanguage);

      if (similarity >= this.tier2Threshold) {
        logger.debug({ tier: 2, similarity }, 'Tier 2: Few-shot with examples');
        return {
          tier: 2,
          tierName: 'few-shot',
          examples: similarQueries.slice(0, 3),
          confidence: similarity,
        };
      }

      // Tier 3: Some matches but lower confidence
      if (similarity >= this.tier3Threshold) {
        logger.debug({ tier: 3, similarity }, 'Tier 3: Full pipeline');
        return {
          tier: 3,
          tierName: 'full-pipeline',
          examples: similarQueries.slice(0, 5),
          confidence: similarity,
        };
      }
    }

    // Tier 4: No good matches, LLM-only
    logger.debug({ tier: 4 }, 'Tier 4: LLM fallback');
    return {
      tier: 4,
      tierName: 'llm-fallback',
      confidence: 0,
    };
  }

  /**
   * Add a successful query to the cache
   */
  addToCache(naturalLanguage: string, sql: string, confidence: number): void {
    const key = this.normalizeQuery(naturalLanguage);

    this.cache.set(key, {
      naturalLanguage,
      sql,
      confidence,
      lastUsed: new Date(),
      useCount: 1,
    });

    // Evict LRU if over limit
    if (this.cache.size > this.maxCacheSize) {
      this.evictLRU();
    }
  }

  /**
   * Update cache confidence after successful use
   */
  recordSuccess(query: string): void {
    const key = this.normalizeQuery(query);
    const cached = this.cache.get(key);
    if (cached) {
      cached.confidence = Math.min(1.0, cached.confidence + 0.05);
      cached.useCount++;
      cached.lastUsed = new Date();
    }
  }

  /**
   * Lower cache confidence after correction
   */
  recordCorrection(query: string): void {
    const key = this.normalizeQuery(query);
    const cached = this.cache.get(key);
    if (cached) {
      cached.confidence = Math.max(0, cached.confidence - 0.3);
      if (cached.confidence < 0.1) {
        this.cache.delete(key);
      }
    }
  }

  getCacheStats(): { size: number; hitRate: number } {
    const entries = Array.from(this.cache.values());
    const totalUses = entries.reduce((sum, e) => sum + e.useCount, 0);
    return { size: this.cache.size, hitRate: totalUses > 0 ? totalUses / this.cache.size : 0 };
  }

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private computeTextSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      const time = entry.lastUsed.getTime();
      if (time < oldestTime) {
        oldestTime = time;
        oldest = key;
      }
    }

    if (oldest) this.cache.delete(oldest);
  }
}
