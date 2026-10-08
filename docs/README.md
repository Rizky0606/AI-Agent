# Personal AI OS — Phase 0 Documentation

This directory contains the complete Phase 0 architecture baseline.

## Documents

1. Product Requirements
2. System Architecture
3. Agent Kernel
4. Agent Runtimes
5. Model Gateway
6. Memory
7. Task Queue
8. Windows Agent
9. Android
10. MCP
11. Browser
12. Sandbox
13. Permission & Security
14. Evaluator
15. Database
16. API
17. WebSocket
18. Scheduler & Events
19. Observability
20. Deployment
21. Development Roadmap

## Architecture Summary

Android/Web -> API -> Agent Kernel -> Model/Runtime/Tools -> Execution -> Evaluation -> Result.

Oracle Cloud ARM64 is the control plane. Windows is the local execution plane. 9Router is the primary external LLM gateway.

## Phase 0 Exit Criteria

Architecture contracts are agreed, implementation boundaries are clear, MVP vertical slices are defined, and security/operational constraints are documented.

## Next
Proceed to Phase 1 — Foundation & Infrastructure.
