/**
 * Base LLM provider interface
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export abstract class BaseLLMProvider {
  abstract generateCompletion(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse>;

  abstract generateEmbedding(text: string): Promise<number[]>;

  /**
   * Helper method to create a SQL generation prompt
   */
  protected createSQLPrompt(
    query: string,
    schema: string,
    examples?: string,
    conversationContext?: string
  ): LLMMessage[] {
    const systemPrompt = `You are an expert PostgreSQL query generator. Your task is to convert natural language queries into accurate, efficient SQL queries.

Database Schema:
${schema}

${examples ? `Examples:\n${examples}\n` : ''}

${conversationContext ? `Recent Conversation:\n${conversationContext}\n` : ''}

Rules:
1. Generate ONLY valid PostgreSQL syntax
2. Use proper joins and indexable columns
3. Include appropriate WHERE clauses for filtering
4. Use meaningful aliases
5. Return ONLY the SQL query without explanation
6. Use parameterized queries when appropriate
7. Consider performance and use proper indexes
8. Handle NULL values appropriately
9. Use EXPLAIN when analyzing complex queries
10. Follow PostgreSQL best practices

IMPORTANT - Understanding Column References:
- When user mentions a column name directly (like "parent_id", "price", "stock_quantity"), they want to see the VALUES in that column
- "quels sont les parent_id?" or "c'est quoi les parent_id?" means: SELECT DISTINCT parent_id FROM categories
- "quel sont les parents?" means: SELECT * FROM categories WHERE parent_id IS NULL (conceptual parent categories)
- Pay close attention to whether the user is asking about a specific column name vs a conceptual question
- If in doubt, prefer literal interpretation of column names mentioned

CONVERSATIONAL CONTEXT:
- If the user's query is vague (like "je veux les valeurs", "montre moi plus", "et les détails?"), look at the recent conversation context
- The user is likely referring to columns, tables, or concepts from their previous question
- Use the previous SQL query as a hint for what data they're interested in
- Example: After "c'est quoi les parent_id?" (shows distinct parent_id values),
  if user asks "je veux les valeurs", they might want all parent_id values with more details:
  SELECT parent_id, COUNT(*) as count FROM categories WHERE parent_id IS NOT NULL GROUP BY parent_id

Output format:
Return ONLY the SQL query as a valid JSON object with this structure:
{
  "sql": "SELECT ...",
  "explanation": "Brief explanation of the query",
  "confidence": 0.95
}`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Generate a PostgreSQL query for: ${query}` },
    ];
  }

  /**
   * Helper method to create an optimization prompt
   */
  protected createOptimizationPrompt(
    sql: string,
    executionPlan: string,
    schema: string
  ): LLMMessage[] {
    const systemPrompt = `You are an expert PostgreSQL query optimizer. Analyze the given SQL query and its execution plan to suggest optimizations.

Database Schema:
${schema}

Current Execution Plan:
${executionPlan}

Analyze:
1. Sequential scans that could be indexed
2. Inefficient joins
3. Missing indexes
4. Suboptimal WHERE clause ordering
5. Opportunities for materialized views
6. Query rewrite possibilities

Output format:
Return ONLY valid JSON with this structure:
{
  "optimizedSQL": "SELECT ...",
  "suggestions": [
    {
      "type": "index|rewrite|cache|partition",
      "description": "Description of the optimization",
      "impact": "high|medium|low",
      "sql": "CREATE INDEX ..." (optional)
    }
  ],
  "improvement": "Estimated improvement description"
}`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Optimize this SQL query:\n\n${sql}` },
    ];
  }

  /**
   * Helper method to extract JSON from LLM response
   */
  protected extractJSON(response: string): any {
    // Try to find JSON in code blocks
    const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1]);
    }

    // Try to find raw JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error('No valid JSON found in LLM response');
  }
}
