/**
 * Multi-Candidate SQL Selector (Phase 1B)
 * Inspired by Contextual AI bird-sql (#1 BIRD benchmark)
 *
 * Generates N SQL candidates in parallel with varied temperatures,
 * filters invalid ones, ranks by execution cost, selects the best.
 */

import { BaseLLMProvider, LLMMessage } from '../llm/base';
import { DatabaseAdapter } from '../database/adapter';
import { ResultVerifier } from './result-verifier';
import { DatabaseSchema } from '../types';
import { logger } from '../utils/logger';

export interface CandidateResult {
  sql: string;
  temperature: number;
  valid: boolean;
  cost?: number;
  schemaIssues: string[];
}

export interface SelectionResult {
  bestSQL: string;
  candidates: CandidateResult[];
  selectionMethod: 'single' | 'cost-based' | 'llm-tiebreak' | 'first-valid';
}

export class CandidateSelector {
  private llm: BaseLLMProvider;
  private adapter: DatabaseAdapter;
  private verifier: ResultVerifier;
  private defaultCandidateCount = 3;
  private temperatures = [0.0, 0.2, 0.4];

  constructor(llm: BaseLLMProvider, adapter: DatabaseAdapter) {
    this.llm = llm;
    this.adapter = adapter;
    this.verifier = new ResultVerifier(adapter);
  }

  async select(
    queryText: string,
    _schemaText: string,
    _examples: string,
    schema: DatabaseSchema,
    generateFn: (temp: number) => Promise<string>,
    candidateCount?: number
  ): Promise<SelectionResult> {
    const count = candidateCount || this.defaultCandidateCount;
    const temps = this.temperatures.slice(0, count);

    logger.debug({ candidateCount: count }, 'Generating SQL candidates');

    // Generate candidates in parallel
    const candidatePromises = temps.map(async (temp): Promise<CandidateResult> => {
      try {
        const sql = await generateFn(temp);
        return { sql, temperature: temp, valid: true, schemaIssues: [] };
      } catch (error) {
        return { sql: '', temperature: temp, valid: false, schemaIssues: ['Generation failed'] };
      }
    });

    const candidates = await Promise.all(candidatePromises);

    // Filter: quickVerify eliminates those with schema issues
    for (const candidate of candidates) {
      if (!candidate.sql) {
        candidate.valid = false;
        continue;
      }
      const verification = this.verifier.quickVerify(candidate.sql, schema);
      if (!verification.valid) {
        candidate.valid = false;
        candidate.schemaIssues = verification.issues;
      }
    }

    const validCandidates = candidates.filter(c => c.valid);

    if (validCandidates.length === 0) {
      // All failed verification — return first generated as fallback
      const firstGenerated = candidates.find(c => c.sql);
      return {
        bestSQL: firstGenerated?.sql || '',
        candidates,
        selectionMethod: 'first-valid',
      };
    }

    if (validCandidates.length === 1) {
      return {
        bestSQL: validCandidates[0].sql,
        candidates,
        selectionMethod: 'single',
      };
    }

    // Deduplicate identical SQL
    const uniqueSQL = new Map<string, CandidateResult>();
    for (const c of validCandidates) {
      const normalized = c.sql.trim().replace(/\s+/g, ' ');
      if (!uniqueSQL.has(normalized)) {
        uniqueSQL.set(normalized, c);
      }
    }

    const uniqueCandidates = Array.from(uniqueSQL.values());
    if (uniqueCandidates.length === 1) {
      return {
        bestSQL: uniqueCandidates[0].sql,
        candidates,
        selectionMethod: 'single',
      };
    }

    // Rank by execution cost via EXPLAIN
    const costPromises = uniqueCandidates.map(async (candidate) => {
      try {
        const plan = await this.adapter.explain(candidate.sql);
        const cost = this.extractCost(plan);
        candidate.cost = cost;
      } catch {
        candidate.cost = Infinity;
      }
    });

    await Promise.all(costPromises);

    // Sort by cost (lower is better)
    uniqueCandidates.sort((a, b) => (a.cost || Infinity) - (b.cost || Infinity));

    const best = uniqueCandidates[0];
    const second = uniqueCandidates[1];

    // If costs are very close, use LLM to tiebreak
    if (best.cost && second.cost && best.cost !== Infinity && second.cost !== Infinity) {
      const costRatio = second.cost / best.cost;
      if (costRatio < 1.2) {
        // Costs within 20% — let LLM decide
        const tiebreakResult = await this.llmTiebreak(queryText, best.sql, second.sql);
        return {
          bestSQL: tiebreakResult,
          candidates,
          selectionMethod: 'llm-tiebreak',
        };
      }
    }

    return {
      bestSQL: best.sql,
      candidates,
      selectionMethod: 'cost-based',
    };
  }

  private extractCost(plan: any): number {
    if (!plan) return Infinity;

    // Handle array of plan rows (PostgreSQL EXPLAIN output)
    if (Array.isArray(plan)) {
      const planText = plan.map((r: any) => JSON.stringify(r)).join(' ');
      const costMatch = planText.match(/cost=[\d.]+\.\.([\d.]+)/);
      if (costMatch) return parseFloat(costMatch[1]);

      // Try QUERY PLAN format
      const qpMatch = planText.match(/"QUERY PLAN"\s*:\s*"[^"]*cost=[\d.]+\.\.([\d.]+)/);
      if (qpMatch) return parseFloat(qpMatch[1]);
    }

    // Handle object format
    if (typeof plan === 'object' && plan !== null) {
      if (plan['Total Cost']) return plan['Total Cost'];
      if (plan['QUERY PLAN']) {
        const match = String(plan['QUERY PLAN']).match(/cost=[\d.]+\.\.([\d.]+)/);
        if (match) return parseFloat(match[1]);
      }
    }

    return Infinity;
  }

  private async llmTiebreak(queryText: string, sqlA: string, sqlB: string): Promise<string> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: 'You are a SQL expert. Choose the better query for the user\'s intent. Reply with ONLY "A" or "B".',
      },
      {
        role: 'user',
        content: `User question: "${queryText}"\n\nQuery A:\n${sqlA}\n\nQuery B:\n${sqlB}\n\nWhich is better? Reply A or B only.`,
      },
    ];

    try {
      const response = await this.llm.generateCompletion(messages, { temperature: 0, maxTokens: 10 });
      return response.content.trim().toUpperCase().startsWith('B') ? sqlB : sqlA;
    } catch {
      return sqlA; // Default to A on failure
    }
  }
}
