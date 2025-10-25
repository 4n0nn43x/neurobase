# Contributing to NeuroBase

Thank you for your interest in contributing to NeuroBase! This document provides guidelines and instructions for contributing.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [How to Contribute](#how-to-contribute)
5. [Coding Standards](#coding-standards)
6. [Testing](#testing)
7. [Commit Guidelines](#commit-guidelines)
8. [Pull Request Process](#pull-request-process)

---

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors.

### Expected Behavior

- Use welcoming and inclusive language
- Be respectful of differing viewpoints
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards other contributors

### Unacceptable Behavior

- Harassment or discriminatory language
- Trolling or insulting comments
- Personal or political attacks
- Publishing others' private information
- Other unethical or unprofessional conduct

---

## Getting Started

### Prerequisites

- Node.js 18+ or Python 3.10+
- Git
- Tiger Data account
- LLM provider API key (OpenAI, Anthropic, or Ollama)

### Areas for Contribution

We welcome contributions in:

- **Bug fixes**: Fix issues reported in GitHub Issues
- **Features**: Implement new features from the roadmap
- **Documentation**: Improve or expand documentation
- **Tests**: Add or improve test coverage
- **Examples**: Create example applications
- **Performance**: Optimize query processing or learning
- **LLM providers**: Add support for new providers
- **Agents**: Create new specialized agents

---

## Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub
# Then clone your fork
git clone https://github.com/YOUR_USERNAME/neurobase.git
cd neurobase

# Add upstream remote
git remote add upstream https://github.com/original/neurobase.git
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 4. Run Tests

```bash
npm test
```

### 5. Start Development

```bash
npm run dev
```

---

## How to Contribute

### Reporting Bugs

1. Check if the bug is already reported in [Issues](https://github.com/yourusername/neurobase/issues)
2. If not, create a new issue with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Node version, etc.)
   - Error messages or logs

**Bug Report Template:**

```markdown
**Description**
A clear description of the bug.

**To Reproduce**
Steps to reproduce:
1. Run command '...'
2. Execute query '...'
3. See error

**Expected Behavior**
What you expected to happen.

**Actual Behavior**
What actually happened.

**Environment**
- OS: [e.g., macOS 13.0]
- Node.js: [e.g., 18.12.0]
- NeuroBase version: [e.g., 1.0.0]
- LLM Provider: [e.g., OpenAI GPT-4]

**Logs**
```
Paste relevant logs here
```
```

### Suggesting Features

1. Check [existing feature requests](https://github.com/yourusername/neurobase/issues?q=label%3Aenhancement)
2. Create a new issue with:
   - Clear use case
   - Proposed solution
   - Alternatives considered
   - Examples

**Feature Request Template:**

```markdown
**Feature Description**
A clear description of the feature.

**Use Case**
Why is this feature needed?

**Proposed Solution**
How would you implement this?

**Alternatives**
What alternatives have you considered?

**Additional Context**
Any other relevant information.
```

---

## Coding Standards

### TypeScript Style Guide

We follow standard TypeScript best practices:

```typescript
// Use meaningful variable names
const userQueryResult = await nb.query("...");

// Add types for all function parameters and returns
async function processQuery(query: string): Promise<QueryResult> {
  // Implementation
}

// Use async/await over promises
const result = await database.query(sql);

// Prefer interfaces over types for objects
interface QueryOptions {
  timeout?: number;
  cache?: boolean;
}

// Use const for immutable values
const MAX_RETRY_COUNT = 3;

// Document public APIs with JSDoc
/**
 * Execute a natural language query
 * @param query - The natural language query
 * @returns Query result with data and metadata
 */
async query(query: string): Promise<QueryResult> {
  // Implementation
}
```

### File Organization

```
src/
├── agents/          # Agent implementations
├── core/            # Core orchestrator
├── database/        # Database connections and schema
├── llm/             # LLM provider integrations
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
└── ui/              # User interfaces (CLI, API)
```

### Naming Conventions

- **Classes**: PascalCase (`LinguisticAgent`)
- **Functions**: camelCase (`generateSQL`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_QUERY_TIME`)
- **Files**: kebab-case (`linguistic-agent.ts`)
- **Interfaces**: PascalCase with descriptive names (`QueryResult`)

### Code Comments

```typescript
// Good: Explain WHY, not WHAT
// Cache embeddings to avoid redundant API calls
const embedding = await this.getEmbedding(query);

// Bad: Redundant comment
// Get embedding
const embedding = await this.getEmbedding(query);
```

---

## Testing

### Test Structure

```typescript
// tests/agents/linguistic.test.ts
describe('LinguisticAgent', () => {
  let agent: LinguisticAgent;

  beforeEach(() => {
    agent = new LinguisticAgent(mockLLM);
  });

  describe('process', () => {
    it('should generate SQL from natural language', async () => {
      const result = await agent.process({
        query: { text: 'Show me all users' },
        schema: mockSchema,
      });

      expect(result.sql).toContain('SELECT');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should request clarification for ambiguous queries', async () => {
      const result = await agent.process({
        query: { text: 'Show me recent data' },
        schema: mockSchema,
      });

      expect(result.clarificationNeeded).toBeDefined();
    });
  });
});
```

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage

# Specific test file
npm test linguistic.test.ts
```

### Test Coverage Requirements

- Minimum 80% code coverage
- 100% coverage for critical paths (query processing, SQL generation)
- Integration tests for all agents
- E2E tests for CLI and API

---

## Commit Guidelines

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Scope:**
- `agent`: Agent-related changes
- `llm`: LLM provider changes
- `core`: Core functionality
- `cli`: CLI changes
- `api`: API changes
- `docs`: Documentation

**Examples:**

```bash
feat(agent): add support for multi-turn conversations

Add conversation context tracking to Linguistic Agent.
This allows the agent to reference previous queries
in the same conversation.

Closes #123
```

```bash
fix(llm): handle OpenAI rate limit errors

Add exponential backoff retry logic for OpenAI API
rate limit errors (HTTP 429).

Fixes #456
```

---

## Pull Request Process

### Before Submitting

1. ✅ Sync with upstream
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. ✅ Run tests
   ```bash
   npm test
   ```

3. ✅ Run linter
   ```bash
   npm run lint
   ```

4. ✅ Update documentation if needed

5. ✅ Add tests for new features

### Submitting a PR

1. Create a descriptive branch name:
   ```bash
   git checkout -b feat/add-conversation-context
   ```

2. Make your changes and commit:
   ```bash
   git add .
   git commit -m "feat(agent): add conversation context"
   ```

3. Push to your fork:
   ```bash
   git push origin feat/add-conversation-context
   ```

4. Open a PR on GitHub with:
   - Clear title
   - Description of changes
   - Link to related issues
   - Screenshots (if UI changes)

### PR Template

```markdown
## Description
Brief description of the changes.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Closes #123

## Testing
Describe how you tested these changes.

## Checklist
- [ ] Tests pass locally
- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### Review Process

1. Maintainers will review within 3-5 business days
2. Address review feedback
3. Once approved, a maintainer will merge

---

## Development Tips

### Hot Reload

```bash
npm run dev
# CLI will reload on file changes
```

### Debugging

```typescript
// Add debug logs
import { logger } from './utils/logger';

logger.debug('Processing query', { query });
```

```bash
# Enable debug logging
export NEUROBASE_LOG_LEVEL=debug
```

### Testing with Different LLM Providers

```bash
# Test with OpenAI
export LLM_PROVIDER=openai
npm run dev

# Test with Anthropic
export LLM_PROVIDER=anthropic
npm run dev

# Test with Ollama
export LLM_PROVIDER=ollama
npm run dev
```

---

## Adding a New LLM Provider

1. Create provider class:
   ```typescript
   // src/llm/providers/custom.ts
   export class CustomProvider extends BaseLLMProvider {
     async generateCompletion(messages, options) {
       // Implementation
     }

     async generateEmbedding(text) {
       // Implementation
     }
   }
   ```

2. Update factory:
   ```typescript
   // src/llm/index.ts
   export class LLMFactory {
     static create(config: LLMConfig): BaseLLMProvider {
       switch (config.provider) {
         case 'custom':
           return new CustomProvider(config.custom);
         // ...
       }
     }
   }
   ```

3. Add tests:
   ```typescript
   // tests/llm/providers/custom.test.ts
   describe('CustomProvider', () => {
     // Tests
   });
   ```

4. Update documentation

---

## Adding a New Agent

1. Create agent class:
   ```typescript
   // src/agents/custom.ts
   export class CustomAgent implements Agent {
     name = 'CustomAgent';

     async process(input: any): Promise<any> {
       // Implementation
     }
   }
   ```

2. Integrate into core:
   ```typescript
   // src/core/neurobase.ts
   this.customAgent = new CustomAgent();
   ```

3. Add tests

4. Document the agent

---

## Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Tiger Data Docs](https://docs.tigerdata.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

---

## Questions?

- Open a [GitHub Discussion](https://github.com/yourusername/neurobase/discussions)
- Join our [Discord](https://discord.gg/neurobase)
- Email: contribute@neurobase.dev

---

## License

By contributing to NeuroBase, you agree that your contributions will be licensed under the MIT License.
