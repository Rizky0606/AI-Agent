# Memory Architecture

## Memory Types
- Short-term conversation
- Long-term personal memory
- Project memory
- Task memory
- User preferences
- Knowledge
- Decision memory

## Storage
PostgreSQL is the source of truth.
pgvector stores embeddings for semantic retrieval.

## Flow
Candidate -> relevance evaluation -> embedding -> storage -> retrieval -> context injection.

## Memory Rules
Do not store every message as long-term memory.
Prefer stable, useful, reusable facts.

## Retrieval
Retrieve by:
- project
- task
- semantic similarity
- recency
- importance
- explicit user references

## Safety
Sensitive data should not be persisted unless explicitly required and permitted.
