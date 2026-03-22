/**
 * Feedback Loop with Temporal Decay
 * Manages learning entry weights based on usage, corrections, and time
 */

import { logger } from '../utils/logger';

export interface WeightedEntry {
  id: string;
  weight: number;
  lastUsed: Date;
  createdAt: Date;
  useCount: number;
  correctionCount: number;
}

export class FeedbackLoop {
  private entries: Map<string, WeightedEntry> = new Map();
  private decayRate = 0.99; // per day
  private archiveThreshold = 0.1;
  private archiveAfterDays = 90;

  /**
   * Record successful reuse of a learning entry
   */
  recordSuccess(entryId: string): void {
    const entry = this.getOrCreate(entryId);
    entry.weight = Math.min(2.0, entry.weight + 0.1);
    entry.useCount++;
    entry.lastUsed = new Date();
    logger.debug({ entryId, weight: entry.weight }, 'Feedback: success recorded');
  }

  /**
   * Record a correction to a learning entry
   */
  recordCorrection(entryId: string): void {
    const entry = this.getOrCreate(entryId);
    entry.weight = Math.max(0, entry.weight - 0.5);
    entry.correctionCount++;
    entry.lastUsed = new Date();
    logger.debug({ entryId, weight: entry.weight }, 'Feedback: correction recorded');
  }

  /**
   * Get the current weight for an entry
   */
  getWeight(entryId: string): number {
    const entry = this.entries.get(entryId);
    if (!entry) return 1.0; // Default weight

    // Apply temporal decay
    return this.applyDecay(entry);
  }

  /**
   * Apply temporal decay to all entries and archive stale ones
   */
  applyDecayToAll(): { active: number; archived: number } {
    const now = new Date();
    let archived = 0;

    for (const [id, entry] of this.entries.entries()) {
      const decayedWeight = this.applyDecay(entry);
      entry.weight = decayedWeight;

      // Archive if below threshold and old enough
      const ageDays = (now.getTime() - entry.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (decayedWeight < this.archiveThreshold && ageDays > this.archiveAfterDays) {
        this.entries.delete(id);
        archived++;
      }
    }

    return { active: this.entries.size, archived };
  }

  /**
   * Get entries sorted by weight (for ranking)
   */
  rankEntries(entryIds: string[]): string[] {
    return entryIds
      .map(id => ({ id, weight: this.getWeight(id) }))
      .sort((a, b) => b.weight - a.weight)
      .map(e => e.id);
  }

  /**
   * Adjust score by feedback weight for ranking
   */
  adjustScore(entryId: string, baseScore: number): number {
    const weight = this.getWeight(entryId);
    return baseScore * weight;
  }

  getStats(): { totalEntries: number; avgWeight: number; highWeight: number; lowWeight: number } {
    const entries = Array.from(this.entries.values());
    if (entries.length === 0) {
      return { totalEntries: 0, avgWeight: 0, highWeight: 0, lowWeight: 0 };
    }

    const weights = entries.map(e => this.applyDecay(e));
    return {
      totalEntries: entries.length,
      avgWeight: weights.reduce((s, w) => s + w, 0) / weights.length,
      highWeight: Math.max(...weights),
      lowWeight: Math.min(...weights),
    };
  }

  private getOrCreate(entryId: string): WeightedEntry {
    let entry = this.entries.get(entryId);
    if (!entry) {
      entry = {
        id: entryId,
        weight: 1.0,
        lastUsed: new Date(),
        createdAt: new Date(),
        useCount: 0,
        correctionCount: 0,
      };
      this.entries.set(entryId, entry);
    }
    return entry;
  }

  private applyDecay(entry: WeightedEntry): number {
    const now = new Date();
    const daysSinceUse = (now.getTime() - entry.lastUsed.getTime()) / (1000 * 60 * 60 * 24);
    return entry.weight * Math.pow(this.decayRate, daysSinceUse);
  }
}
