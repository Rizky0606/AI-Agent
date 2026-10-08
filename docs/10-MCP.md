# MCP Integration Architecture

## Purpose
MCP is the standardized tool integration layer.

## Initial Integrations
- GitHub
- Gmail
- Google Drive
- Slack
- Notion
- PostgreSQL
- Filesystem
- Playwright
- custom APIs

## Flow
Agent -> Tool Manager -> Permission Engine -> MCP Gateway -> MCP Server -> External System.

## Tool Metadata
Each tool declares:
- name
- capability
- risk level
- required scopes
- timeout
- idempotency where applicable

## Security
Tools cannot bypass Permission Engine.
Sensitive tool output must be redacted before being returned to models or clients.
