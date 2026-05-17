# Quick Start

Get NeuroBase running in under 5 minutes.

## 1. Configure

```bash
npx neurobase setup
```

The wizard will ask for:
- LLM provider (Anthropic / OpenAI / OpenRouter / Ollama) and API key — validated live
- Database engine and connection URL — tested live
- Feature toggles
- Privacy mode

The result is saved to `~/.neurobase/` (profile + credentials, no `.env`
needed). You can re-run individual sections later: `setup db`, `setup token`,
`setup model`, etc.

## 2. Verify everything is wired up

```bash
npx neurobase doctor
```

## 3. Initialize sample data (optional)

```bash
npx neurobase init
```

Type `y` when prompted to load the sample e-commerce schema.

## 4. Start querying

```bash
npx neurobase
```

## Example Queries

### Basic

```
neurobase > show me all users
neurobase > how many products do we have?
neurobase > list all categories
```

### Aggregations

```
neurobase > total sales this month
neurobase > average order value by category
neurobase > count orders by status
```

### Joins

```
neurobase > show users with their orders
neurobase > products with category names
neurobase > orders with customer details
```

### Filters

```
neurobase > users created this week
neurobase > products over $500
neurobase > pending orders
```

### Complex

```
neurobase > top 5 customers by total spending
neurobase > products with highest ratings that are in stock
neurobase > monthly revenue trend for this year
```

### Follow-up (context preserved)

```
neurobase > show me all categories
neurobase > with their product counts
neurobase > sort by count descending
```

### French

```
neurobase > combien de commandes cette semaine ?
neurobase > montre les produits les plus vendus
neurobase > quels clients n'ont pas commandé depuis 30 jours ?
```

## REPL Commands

| Command | Action |
|---------|--------|
| `/help` | Show all commands |
| `/schema` | Display database schema with relationships |
| `/stats` | Show database + LLM cost statistics |
| `/costs` | Detailed LLM cost breakdown for today (tokens, USD, top models) |
| `/clear` | Clear screen and history |
| `/model [id]` | Switch LLM model (searchable picker if no id) |
| `/db [name]` | List or switch the active database |
| `/serve [port]` | Launch the REST API server as a background child process |
| `/multi-agent [port]` | Launch the multi-agent API server (auto-generates a bearer token) |
| `/services` | List running background services |
| `/stop <name>` | Stop a service (`rest-api`, `multi-agent`, or `all`) |
| `/fork` | Create a database fork for testing |
| `/forks` | List active forks |
| `/fork-delete <id>` | Delete a fork |
| `/exit` | Quit |

The `.` prefix is kept as a silent alias for backwards compatibility.

## API Mode

```bash
npx neurobase serve
```

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "show all users"}'
```

## Self-Correction in Action

If your query references a misspelled table or column, NeuroBase auto-corrects:

```
neurobase > show products from the "electronik" category

  ╭── ⟩ SQL ──────────────────────────────────────────╮
  │ SELECT p.* FROM products p                         │
  │ JOIN categories c ON p.category_id = c.id          │
  │ WHERE LOWER(c.name) = LOWER('electronics')         │
  ╰────────────────────────────────────────────────────╯

  ⊞ 5 rows  │  ⏱ 120ms  │  ⟳ auto-corrected  │  ◉ learned
```

The value explorer detected "electronik" doesn't exist, found "Electronics" as the closest match, and the LLM used the correct value.

## Next Steps

- [Full feature documentation](../README.md)
- [Architecture guide](architecture.md)
- [API reference](api-reference.md)
- [Multi-agent system](multi-agent-system.md)
