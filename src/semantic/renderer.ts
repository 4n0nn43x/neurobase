/**
 * Semantic Model Renderer (Phase 2B)
 * Converts the semantic model into LLM-optimized text
 */

import { SemanticModel } from '../types';

export class SemanticRenderer {
  /**
   * Render semantic model as context text for LLM prompts
   */
  static render(model: SemanticModel): string {
    if (!model.entities || model.entities.length === 0) return '';

    let text = '\n# BUSINESS SEMANTIC MODEL\n';
    text += 'Use these business concepts when interpreting queries:\n\n';

    for (const entity of model.entities) {
      text += `## ${entity.name}`;
      if (entity.table) text += ` (table: ${entity.table})`;
      text += '\n';

      if (entity.description) {
        text += `${entity.description}\n`;
      }

      if (entity.metrics && entity.metrics.length > 0) {
        text += 'Metrics:\n';
        for (const metric of entity.metrics) {
          text += `  - ${metric.name}: ${metric.expression}`;
          if (metric.description) text += ` — ${metric.description}`;
          text += '\n';
        }
      }

      if (entity.relationships && entity.relationships.length > 0) {
        text += 'Relationships:\n';
        for (const rel of entity.relationships) {
          text += `  - ${rel.type} → ${rel.target} (JOIN: ${rel.join})\n`;
        }
      }

      text += '\n';
    }

    return text;
  }
}
