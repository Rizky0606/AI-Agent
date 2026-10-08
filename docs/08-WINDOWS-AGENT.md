# Windows Agent Specification

## Role
Windows is the local execution plane for private/local development work.

## Stack
- Tauri 2
- Rust
- TypeScript
- local background service

## Capabilities
- filesystem
- terminal
- PowerShell
- Git
- Node.js
- Python
- package managers
- Docker
- browser
- screenshots
- process management
- optional VS Code integration

## Communication
Windows Agent -> WSS -> VPS.

## Lifecycle
starting -> authenticating -> connected -> ready -> busy -> idle -> disconnected

## Security
- Device identity
- encrypted communication
- scoped workspace
- capability registration
- audit logging
- least privilege

## Workspace
Do not grant unrestricted drive access by default. Configure explicit allowed paths.

## Disconnect
Tasks must remain durable when Windows goes offline. Pause, retry, or reroute where possible.
