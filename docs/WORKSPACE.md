# Workspace Foundation

The repository is a pnpm workspace orchestrated by Turborepo. TypeScript packages extend `tsconfig.base.json`; root ESLint and Prettier configuration provide shared defaults.

## Package conventions

- `apps/*` are deployable application entrypoints.
- `packages/*` are reusable domain boundaries.
- `runtimes/*` are adapter boundaries for external agents.
- Every TypeScript workspace exposes `build`, `lint`, `typecheck`, and `test` scripts so root Turbo commands remain uniform.
- Foundation packages have no business logic or provider credentials.
