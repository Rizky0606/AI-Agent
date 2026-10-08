# API Specification

## Stack
Fastify + TypeScript.

## Base Path
`/api/v1`

## Initial Resources
- /auth
- /users
- /projects
- /sessions
- /messages
- /tasks
- /agents
- /memory
- /files
- /artifacts
- /approvals
- /skills
- /tools
- /devices

## API Principles
- schema validation
- typed responses
- consistent error format
- request IDs
- authentication middleware
- authorization
- rate limiting
- idempotency for mutation endpoints where needed

## Error
```json
{
  "error": {
    "code": "PERMISSION_ERROR",
    "message": "Approval required",
    "retryable": false,
    "traceId": "..."
  }
}
```
