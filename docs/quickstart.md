# Quick Start

Get NeuroBase running in under 5 minutes.

## 1. Install and configure

```bash
npx neurobase setup
```

The wizard will ask for:
- Database engine and connection URL
- LLM provider and API key
- Feature toggles
- Privacy mode

This creates a `.env` file in the current directory.

## 2. Initialize database

```bash
npx neurobase init
```

Type `y` when prompted to load sample e-commerce data.

## 3. Start querying

```bash
npx neurobase interactive
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

## CLI Commands

| Command | Action |
|---------|--------|
| `.help` | Show all commands |
| `.schema` | Display database schema with relationships |
| `.stats` | Show database statistics |
| `.clear` | Clear screen and history |
| `.fork` | Create a database fork for testing |
| `.forks` | List active forks |
| `.fork-delete <id>` | Delete a fork |
| `.exit` | Quit |

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
