/**
 * Semantic Model Loader (Phase 2B)
 * Loads semantic model from neurobase.semantic.yml
 */

import { readFileSync, existsSync } from 'fs';
import { SemanticModel } from '../types';
import { logger } from '../utils/logger';

export class SemanticLoader {
  /**
   * Load semantic model from a YAML file.
   * Returns null if file doesn't exist (retrocompatible).
   */
  static load(filePath: string): SemanticModel | null {
    if (!existsSync(filePath)) {
      logger.debug({ filePath }, 'Semantic model file not found, skipping');
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return SemanticLoader.parseYAML(content);
    } catch (error) {
      logger.warn({ error, filePath }, 'Failed to load semantic model');
      return null;
    }
  }

  /**
   * Simple YAML parser for the semantic model format.
   * Handles the specific structure without requiring a full YAML library.
   */
  static parseYAML(content: string): SemanticModel {
    const model: SemanticModel = { entities: [] };
    const lines = content.split('\n');

    let currentEntity: any = null;
    let currentMetric: any = null;
    let currentRelationship: any = null;
    let context: 'root' | 'entities' | 'entity' | 'metrics' | 'metric' | 'relationships' | 'relationship' = 'root';

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const key = trimmed.trim();

      if (key === 'entities:') {
        context = 'entities';
        continue;
      }

      if (key === 'version:') {
        const val = trimmed.split(':').slice(1).join(':').trim().replace(/^["']|["']$/g, '');
        model.version = val;
        continue;
      }

      if (context === 'entities' || context === 'entity' || context === 'metrics' || context === 'metric' || context === 'relationships' || context === 'relationship') {
        if (key.startsWith('- name:')) {
          // New entity or list item
          if (context === 'entities' || context === 'entity') {
            if (currentEntity) {
              model.entities.push(currentEntity);
            }
            currentEntity = { name: extractValue(key, '- name:'), table: '', metrics: [], relationships: [] };
            context = 'entity';
          } else if (context === 'metrics' || context === 'metric') {
            if (currentMetric && currentEntity) {
              currentEntity.metrics.push(currentMetric);
            }
            currentMetric = { name: extractValue(key, '- name:') };
            context = 'metric';
          } else if (context === 'relationships' || context === 'relationship') {
            if (currentRelationship && currentEntity) {
              currentEntity.relationships.push(currentRelationship);
            }
            currentRelationship = {};
            context = 'relationship';
          }
        } else if (key.startsWith('- target:')) {
          if (currentRelationship && currentEntity) {
            currentEntity.relationships.push(currentRelationship);
          }
          currentRelationship = { target: extractValue(key, '- target:') };
          context = 'relationship';
        } else if (key === 'metrics:') {
          if (currentMetric && currentEntity) {
            currentEntity.metrics.push(currentMetric);
            currentMetric = null;
          }
          context = 'metrics';
        } else if (key === 'relationships:') {
          if (currentRelationship && currentEntity) {
            currentEntity.relationships.push(currentRelationship);
            currentRelationship = null;
          }
          context = 'relationships';
        } else {
          // Key-value pair
          const [k, ...vParts] = key.split(':');
          const v = vParts.join(':').trim().replace(/^["']|["']$/g, '');

          if (context === 'entity' && currentEntity) {
            if (k.trim() === 'table') currentEntity.table = v;
            else if (k.trim() === 'description') currentEntity.description = v;
          } else if (context === 'metric' && currentMetric) {
            if (k.trim() === 'expression') currentMetric.expression = v;
            else if (k.trim() === 'description') currentMetric.description = v;
          } else if (context === 'relationship' && currentRelationship) {
            if (k.trim() === 'target') currentRelationship.target = v;
            else if (k.trim() === 'type') currentRelationship.type = v;
            else if (k.trim() === 'join') currentRelationship.join = v;
          }
        }
      }
    }

    // Push final items
    if (currentMetric && currentEntity) currentEntity.metrics.push(currentMetric);
    if (currentRelationship && currentEntity) currentEntity.relationships.push(currentRelationship);
    if (currentEntity) model.entities.push(currentEntity);

    return model;
  }
}

function extractValue(line: string, prefix: string): string {
  return line.substring(line.indexOf(prefix) + prefix.length).trim().replace(/^["']|["']$/g, '');
}
