# Agent Runtime Architecture

## Runtime Model
External agents are integrated through adapters rather than merged into one codebase.

runtimes/
- pi-adapter
- omp-adapter
- hermes-adapter
- openhands-adapter

## Routing
- Coding: Pi / OMP / OpenHands
- General autonomous workflows: Hermes
- Research: custom Research Agent
- Browser: Browser Agent
- Local/private work: Windows Agent
- Untrusted/heavy execution: Sandbox

## Adapter Responsibilities
- lifecycle
- input normalization
- output normalization
- cancellation
- pause/resume where supported
- health checks
- capability reporting
- logs/events

## Runtime Result
Every runtime returns normalized:
- status
- summary
- artifacts
- tool calls
- errors
- metrics
