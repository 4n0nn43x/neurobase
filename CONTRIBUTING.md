# Contributing to NeuroBase

Thanks for your interest in making NeuroBase better. This guide covers the
workflow from local setup to merged PR.

## Quick Setup

```bash
git clone https://github.com/4n0nn43x/neurobase.git
cd neurobase
npm install
cp .env.example .env       # edit with your DB and LLM credentials
npm run typecheck          # verify TypeScript compiles
npm run doctor             # built once → node dist/scripts/doctor.js, or:
npm run build && node dist/cli.js doctor
```

Run `neurobase doctor` first — it surfaces most setup issues (Node version,
DB connection, LLM key, PG extensions).

## Project Layout

See [README.md → Project Structure](./README.md#project-structure) for the
full tree. Three areas you'll touch most often:

- `src/agents/` — single-purpose AI agents (one file = one agent).
- `src/rag/` — retrieval and pipeline orchestration (router, pruner,
  candidate selector, self-correction).
- `src/database/adapters/` — one file per SGBD; all conform to
  `src/database/adapter.ts`.

## Development Loop

| Command | What it does |
|---|---|
| `npm run dev` | tsx watch on `src/cli.ts` |
| `npm run dev:multi-agent` | tsx watch on multi-agent API |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over `src/` |
| `npm run format` | Prettier write |
| `npm run build` | `tsc` to `dist/` |
| `npm test` | Jest with coverage |

The CI gates (`.github/workflows/ci.yml`) run `typecheck`, `lint`, and
`build` on Linux + Windows + macOS across Node 18/20/22.

## Code Standards

- **TypeScript strict mode** — no `any` unless justified in a comment.
- **One concept per file** — agents, adapters, and RAG components are small
  and single-purpose.
- **Comments explain *why*, not *what*** — naming should carry the *what*.
- **No emojis in code or comments** unless the user-facing string requires it.
- **Imports**: external first, then internal, alphabetized within each group.
- **Errors**: throw `Error` with actionable messages; log structured fields via
  `logger.debug({ ... }, 'message')`, not template strings.

## Adding a Database Adapter

1. Create `src/database/adapters/<engine>.ts` that implements
   `DatabaseAdapter` from `src/database/adapter.ts`.
2. Register it in `src/database/adapter-factory.ts`.
3. Extend `DatabaseEngine` in `src/database/adapter.ts`.
4. Add an entry in the `Supported Databases` README table.
5. If the engine supports vectors, wire it into
   `src/database/adapters/vector-support.ts`.
6. Add an integration smoke test under `tests/integration/` (TODO: harness
   in progress).

## Adding an Agent

Agents implement the `Agent` interface from `src/types`. Keep them stateless
where possible; persistent state lives in `MemoryAgent` or in the database.
Wire new agents through `src/core/neurobase.ts` if they participate in the
query pipeline, or through `src/orchestrator/multi-agent-orchestrator.ts` if
they run in the background.

## Commits and PRs

- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- One logical change per PR. Refactors and feature work go in separate PRs.
- PR description should answer: what changed, why, and how it was tested.
- Link related issues with `Closes #N` / `Refs #N`.

## Security Reports

See [SECURITY.md](./SECURITY.md). Do not file public issues for vulnerabilities.

## License

By contributing, you agree your contribution is licensed under the
[MIT License](./LICENSE).
