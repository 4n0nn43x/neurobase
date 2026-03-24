/**
 * Privacy Guard (Phase 3B)
 * Inspired by DataLine (schema-only prompting)
 *
 * Controls what data is sent to the LLM based on privacy mode:
 * - strict: nothing sent externally (local LLM only)
 * - schema-only: schema OK, no row data
 * - permissive: everything allowed
 */

import { logger } from '../utils/logger';

export type PrivacyMode = 'strict' | 'schema-only' | 'permissive';

export class PrivacyGuard {
  private mode: PrivacyMode;

  constructor(mode: PrivacyMode = 'schema-only') {
    this.mode = mode;
    logger.debug({ mode }, 'Privacy guard initialized');
  }

  getMode(): PrivacyMode {
    return this.mode;
  }

  /**
   * Whether schema can be sent to external LLM
   */
  canSendSchema(): boolean {
    return this.mode !== 'strict';
  }

  /**
   * Whether row data can be sent to external LLM
   */
  canSendRowData(): boolean {
    return this.mode === 'permissive';
  }

  /**
   * Whether value exploration (querying actual values) is allowed
   */
  canExploreValues(): boolean {
    return this.mode === 'permissive';
  }

  /**
   * Whether sample data can be used for auto-catalog generation
   */
  canUseSamples(): boolean {
    return this.mode === 'permissive';
  }

  /**
   * Redact row data from a string if not in permissive mode
   */
  redactIfNeeded(text: string, containsRowData: boolean): string {
    if (!containsRowData || this.mode === 'permissive') return text;
    return '[REDACTED - row data not allowed in current privacy mode]';
  }

  /**
   * Filter data for LLM context — removes row data in non-permissive modes
   */
  filterForLLM(data: {
    schema?: string;
    sampleData?: any[];
    queryResults?: any[];
  }): Record<string, any> {
    const filtered: Record<string, any> = {};

    if (data.schema && this.canSendSchema()) {
      filtered.schema = data.schema;
    }

    if (data.sampleData && this.canSendRowData()) {
      filtered.sampleData = data.sampleData;
    }

    if (data.queryResults && this.canSendRowData()) {
      filtered.queryResults = data.queryResults;
    }

    return filtered;
  }
}
