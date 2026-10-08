# Sandbox Architecture

## Purpose
Isolate untrusted or heavy execution from the VPS host and personal Windows environment.

## Preferred Capability
Daytona or equivalent isolated execution environment.

## Use Cases
- package installation
- code execution
- builds
- tests
- browser sessions
- untrusted repositories
- temporary development environments

## Isolation
Sandbox should have:
- ephemeral filesystem
- resource limits
- network policy
- process isolation
- task-scoped credentials
- automatic cleanup

## Routing
Untrusted code -> Sandbox.
Local/private code -> Windows.
Simple server tasks -> VPS worker.
