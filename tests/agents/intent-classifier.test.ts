/**
 * IntentClassifier — rule-based fast path coverage.
 * The LLM fallback is exercised indirectly through the rules layer; for
 * unit-test stability we only test the deterministic rule layer.
 */

import { IntentClassifier } from '../../src/agents/intent-classifier';

describe('IntentClassifier (rule-based)', () => {
  // No LLM passed — only the rule layer runs.
  const classifier = new IntentClassifier();

  describe('conversational', () => {
    it.each([
      'hello',
      'Hi there',
      'salut',
      'bonjour',
      'good morning',
    ])('classifies greeting "%s" as conversational with 100%% confidence', async (input) => {
      const r = await classifier.classify(input);
      expect(r.type).toBe('conversational');
      expect(r.confidence).toBe(1);
      expect(r.suggestedPath.skipLinguistic).toBe(true);
      expect(r.suggestedPath.conversationalResponse).toBeTruthy();
    });

    it('classifies "thanks" as conversational', async () => {
      const r = await classifier.classify('thanks');
      expect(r.type).toBe('conversational');
    });

    it('classifies capability question as conversational with FR helper', async () => {
      const r = await classifier.classify('que peux-tu faire ?');
      expect(r.type).toBe('conversational');
      expect(r.suggestedPath.conversationalResponse).toMatch(/SQL/i);
    });
  });

  describe('metadata', () => {
    it.each([
      'show tables',
      'list databases',
      'describe users',
      'show schema',
      'quelles sont les tables',
    ])('classifies "%s" as metadata', async (input) => {
      const r = await classifier.classify(input);
      expect(r.type).toBe('metadata');
      expect(r.suggestedPath.skipMultiCandidate).toBe(true);
      expect(r.suggestedPath.skipExplainer).toBe(true);
    });
  });

  describe('destructive', () => {
    it.each([
      'DELETE FROM users',
      'drop table orders',
      'TRUNCATE customers',
      'delete all users',
      'remove every row from products',
    ])('classifies "%s" as destructive', async (input) => {
      const r = await classifier.classify(input);
      expect(r.type).toBe('destructive');
    });
  });

  describe('simple-sql', () => {
    it.each([
      'count users',
      'how many orders today',
      'list products',
      'show me customers',
      'combien d\'utilisateurs',
    ])('classifies "%s" as simple-sql', async (input) => {
      const r = await classifier.classify(input);
      expect(r.type).toBe('simple-sql');
      expect(r.suggestedPath.skipMultiCandidate).toBe(true);
    });
  });

  describe('complex-sql', () => {
    it.each([
      'show users with their orders join',
      'group by category having count > 10',
      'compare revenue trend over the last 6 months',
      'union of customers and prospects',
    ])('classifies "%s" as complex-sql', async (input) => {
      const r = await classifier.classify(input);
      expect(r.type).toBe('complex-sql');
      // No skips — full pipeline runs.
      expect(r.suggestedPath.skipMultiCandidate).toBeFalsy();
    });
  });

  describe('unknown fallback', () => {
    it('returns unknown for ambiguous input', async () => {
      const r = await classifier.classify('purple monkey dishwasher');
      expect(r.type).toBe('unknown');
      expect(r.confidence).toBeLessThan(0.5);
    });
  });

  describe('source attribution', () => {
    it('rule-based hits report source = rules', async () => {
      const r = await classifier.classify('hello');
      expect(r.source).toBe('rules');
    });
  });
});
