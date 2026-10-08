# Personal AI OS

Phase 1.1 establishes the pnpm/Turborepo workspace. Business features are intentionally not implemented yet.

## Requirements

- Node.js 20 or newer
- Corepack-enabled pnpm 10

## Commands

```sh
corepack pnpm install
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Workspace layout

| Directory | Purpose |
| --- | --- |
| `apps/` | API, workers, scheduler, web, Android, and Windows client entrypoints |
| `packages/` | Shared domain package boundaries for the agent system |
| `runtimes/` | External agent adapter boundaries |
| `infrastructure/` | Docker, Caddy, PostgreSQL, and monitoring configuration areas |
| `skills/` | Skill content grouped by discipline |
| `scripts/` | Repository automation scripts |
| `docs/` | Phase 0 architecture and implementation references |

Each TypeScript workspace currently contains only its package boundary and a compile-safe entrypoint. Later sessions own feature implementation inside those boundaries.
