# Permission and Security Architecture

## Risk Levels
### LOW
Read/search operations.

### MEDIUM
Local edits, package installation, non-destructive execution.

### HIGH
Git push, email sending, deployment, external side effects.

### CRITICAL
Database destruction, infrastructure destruction, credential/security changes.

## Approval
HIGH/CRITICAL actions require user approval unless explicitly configured otherwise.

## Security Principles
- least privilege
- zero trust
- secret isolation
- sandboxing
- audit everything
- explicit approval
- scoped credentials

## Authentication
- OAuth 2.1
- Passkeys
- access token
- refresh token
- device identity

## Secrets
Store provider credentials only on trusted server/secret storage.
Never embed in Android builds.

## Audit
Record sensitive actions with actor, task, resource, action, result, timestamp, traceId.
