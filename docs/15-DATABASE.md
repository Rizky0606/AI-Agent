# Database Specification

## Database
PostgreSQL + pgvector.

## Core Tables
- users
- devices
- projects
- sessions
- messages
- tasks
- task_steps
- agents
- agent_runs
- memories
- skills
- tools
- permissions
- approvals
- artifacts
- files
- events
- notifications
- audit_logs
- research_runs
- model_usage

## Rules
- UUID identifiers
- timestamps in UTC
- soft deletion where appropriate
- indexes on task/project/session ownership
- foreign keys for integrity
- JSONB for extensible metadata
- pgvector for semantic memory

## Source of Truth
PostgreSQL owns persistent business state.
Redis owns transient queue/cache/lock state.
