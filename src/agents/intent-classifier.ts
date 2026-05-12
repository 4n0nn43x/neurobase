/**
 * Intent Classifier — "head agent" that routes incoming queries.
 *
 * Most queries don't need the full NL→SQL pipeline (linguistic agent +
 * multi-candidate + optimizer + result verifier + executor). A "hello" or
 * "show me the tables" shouldn't trigger 3-5 LLM calls. This classifier
 * runs first and short-circuits when possible.
 *
 * Two-tier strategy for cost control:
 *   1. Rule-based fast path (regex on common patterns) — zero LLM cost,
 *      sub-ms latency. Handles ~60% of real-world queries.
 *   2. LLM fallback for ambiguous inputs — uses the configured provider
 *      with `temperature: 0` and a tight 200-token cap. Cheap (a few cents
 *      on Haiku/gpt-4o-mini).
 *
 * The output is a structured `IntentResult` consumed by `NeuroBase.query()`
 * to pick the right downstream path.
 */

import { BaseLLMProvider, LLMMessage } from '../llm/base';
import { logger } from '../utils/logger';

export type IntentType =
  | 'conversational'    // "hello", "thanks", "what can you do?" — no DB
  | 'metadata'          // "show tables", "describe X" — schema introspection only
  | 'simple-sql'        // "list users", "count orders" — single-table SELECT
  | 'complex-sql'       // joins, aggregations, subqueries — full pipeline
  | 'destructive'       // INSERT/UPDATE/DELETE intents — extra caution
  | 'unknown';          // fallback when classification fails

export interface IntentResult {
  type: IntentType;
  confidence: number;            // 0..1
  source: 'rules' | 'llm';       // which tier produced this
  reasoning?: string;            // optional human-readable explanation
  /** Suggested pipeline shortcuts the caller can take. */
  suggestedPath: {
    skipLinguistic?: boolean;
    skipMultiCandidate?: boolean;
    skipOptimizer?: boolean;
    skipExplainer?: boolean;
    conversationalResponse?: string;
  };
}

export class IntentClassifier {
  private llm?: BaseLLMProvider;

  constructor(llm?: BaseLLMProvider) {
    this.llm = llm;
  }

  /**
   * Classify the user's input. Always returns a result — the worst case
   * is `{ type: 'unknown', confidence: 0.3 }` which routes to the full
   * pipeline (current default behaviour).
   */
  async classify(text: string): Promise<IntentResult> {
    const ruleResult = this.classifyByRules(text);
    if (ruleResult.confidence >= 0.85) return ruleResult;

    if (!this.llm) {
      // No LLM available for fallback — return the best rule-based guess.
      return ruleResult;
    }

    try {
      return await this.classifyByLlm(text);
    } catch (err) {
      logger.debug({ err }, 'Intent LLM classification failed, falling back to rules');
      return ruleResult;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Tier 1: rule-based fast path
  // ────────────────────────────────────────────────────────────────────────

  private classifyByRules(text: string): IntentResult {
    const t = text.trim();
    const lower = t.toLowerCase();

    // Conversational openers / closers — multilingual coverage for FR / EN.
    if (/^(hi|hello|hey|salut|bonjour|coucou|yo|good\s+(morning|evening))\b/i.test(t)) {
      return {
        type: 'conversational',
        confidence: 1.0,
        source: 'rules',
        reasoning: 'Greeting pattern',
        suggestedPath: {
          skipLinguistic: true,
          skipMultiCandidate: true,
          skipOptimizer: true,
          conversationalResponse: this.greetingResponse(t),
        },
      };
    }
    if (/^(thanks?|thank\s+you|merci|cheers|ok|cool|nice)[\s!.]*$/i.test(t)) {
      return {
        type: 'conversational',
        confidence: 1.0,
        source: 'rules',
        reasoning: 'Acknowledgement',
        suggestedPath: {
          skipLinguistic: true, skipMultiCandidate: true, skipOptimizer: true,
          conversationalResponse: 'You\'re welcome.',
        },
      };
    }
    if (/^(what\s+can\s+you\s+do|que\s+peux[- ]tu\s+faire|aide|help)\b/i.test(t)) {
      return {
        type: 'conversational',
        confidence: 0.95,
        source: 'rules',
        reasoning: 'Capability question',
        suggestedPath: {
          skipLinguistic: true, skipMultiCandidate: true, skipOptimizer: true,
          conversationalResponse:
            'I translate natural language into SQL and run it against your active database. ' +
            'Try things like "top 10 customers by revenue", "users created this week", or "/help" to list commands.',
        },
      };
    }

    // Metadata patterns — schema introspection.
    // Either a metadata noun (tables/schema/...) or a DESCRIBE/DESC against any
    // identifier (which is the SQL meta-command for "show columns of this table").
    if (
      /^(show|list|\\d|\.tables)\s+(tables?|schema|databases?|views?|columns?)\b/i.test(t) ||
      /^(describe|desc)\s+\w+/i.test(t)
    ) {
      return {
        type: 'metadata',
        confidence: 0.95,
        source: 'rules',
        reasoning: 'Schema introspection request',
        suggestedPath: { skipMultiCandidate: true, skipOptimizer: true, skipExplainer: true },
      };
    }
    if (/^(quelles?\s+(sont\s+les\s+)?(tables?|colonnes?))/i.test(t)) {
      return {
        type: 'metadata', confidence: 0.95, source: 'rules',
        reasoning: 'Schema introspection request (FR)',
        suggestedPath: { skipMultiCandidate: true, skipOptimizer: true, skipExplainer: true },
      };
    }

    // Destructive intent — requires extra approval path.
    if (/\b(delete|drop|truncate|remove|wipe|clear|destroy|purge)\b/i.test(lower) &&
        /(table|row|record|data|user|all|every)/i.test(lower)) {
      return {
        type: 'destructive',
        confidence: 0.9,
        source: 'rules',
        reasoning: 'Destructive verb + target',
        suggestedPath: { skipExplainer: true },
      };
    }
    if (/^(insert|update|delete|drop|alter|create|truncate)\s+/i.test(t)) {
      return {
        type: 'destructive', confidence: 0.95, source: 'rules',
        reasoning: 'Direct DML/DDL command',
        suggestedPath: { skipExplainer: true },
      };
    }

    // Simple SQL — single-table aggregate or filter.
    const simpleSqlSignals =
      /\b(count|how many|combien|sum|average|avg|total)\b/i.test(lower) ||
      /^(show me|list|give me|find|montre|liste)\b/i.test(t);
    const complexitySignals =
      /\bjoin\b/i.test(lower) ||
      /\bwhere\b.*\band\b.*\bor\b/i.test(lower) ||
      /\bgroup by\b|\bhaving\b|\bunion\b|\bwith\b/i.test(lower) ||
      /(over|across|between|compared to|compare|trend|évolution)/i.test(lower);

    if (simpleSqlSignals && !complexitySignals) {
      return {
        type: 'simple-sql',
        confidence: 0.75,
        source: 'rules',
        reasoning: 'Single-table verb + no complexity signals',
        suggestedPath: { skipMultiCandidate: true },
      };
    }

    if (complexitySignals) {
      return {
        type: 'complex-sql',
        confidence: 0.8,
        source: 'rules',
        reasoning: 'Multi-table or aggregation signals',
        suggestedPath: {},
      };
    }

    // Default — unknown, route to the full pipeline.
    return {
      type: 'unknown',
      confidence: 0.3,
      source: 'rules',
      reasoning: 'No rule match — defaulting to full pipeline',
      suggestedPath: {},
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Tier 2: LLM fallback
  // ────────────────────────────────────────────────────────────────────────

  private async classifyByLlm(text: string): Promise<IntentResult> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content:
          'You classify a user query into one of: conversational, metadata, simple-sql, complex-sql, destructive, unknown. ' +
          'Reply with ONLY valid JSON: { "type": "...", "confidence": 0.0..1.0, "reasoning": "..." }. No prose.',
      },
      { role: 'user', content: text },
    ];

    const response = await this.llm!.generateCompletion(messages, {
      temperature: 0,
      maxTokens: 200,
      // Keep it fast — intent classification should never gate a query for long.
      timeoutMs: 10_000,
    });

    const match = response.content.match(/\{[\s\S]*?\}/);
    if (!match) {
      return { type: 'unknown', confidence: 0.3, source: 'llm', suggestedPath: {} };
    }
    const parsed = JSON.parse(match[0]) as { type: IntentType; confidence?: number; reasoning?: string };

    // Validate the returned type — guard against hallucinations.
    const valid: IntentType[] = ['conversational', 'metadata', 'simple-sql', 'complex-sql', 'destructive', 'unknown'];
    const type = valid.includes(parsed.type) ? parsed.type : 'unknown';

    return {
      type,
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      source: 'llm',
      reasoning: parsed.reasoning,
      suggestedPath: this.defaultPathFor(type),
    };
  }

  private defaultPathFor(type: IntentType): IntentResult['suggestedPath'] {
    switch (type) {
      case 'conversational':
        return { skipLinguistic: true, skipMultiCandidate: true, skipOptimizer: true };
      case 'metadata':
        return { skipMultiCandidate: true, skipOptimizer: true, skipExplainer: true };
      case 'simple-sql':
        return { skipMultiCandidate: true };
      case 'destructive':
        return { skipExplainer: true };
      default:
        return {};
    }
  }

  private greetingResponse(input: string): string {
    if (/(bonjour|salut|coucou)/i.test(input)) return 'Bonjour ! Pose-moi une question sur ta base de données.';
    return 'Hello! Ask me a question about your database.';
  }
}
