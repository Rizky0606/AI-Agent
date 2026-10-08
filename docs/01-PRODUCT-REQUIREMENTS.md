# Personal AI OS — Product Requirements

## Purpose
Define the product vision, users, capabilities, MVP scope, UX principles, and acceptance criteria.

## Vision
Personal AI OS is a private, persistent, multi-agent AI execution platform. Users provide goals in natural language; the system determines the plan, model, runtime, tools, execution environment, permissions, and verification strategy.

## Primary Users
- Developer / power user
- Researcher
- Automation-oriented user
- Content creator

## Core Experience
User -> Intent -> Plan -> Execute -> Evaluate -> Verify -> Result -> Memory

## Clients
- Android: first-class AI client
- Windows: local execution agent
- Web: secondary client

## Core Capabilities
- Streaming AI chat
- Voice/image/file input
- Projects and conversations
- Durable tasks
- Coding agents
- Research agents
- Browser automation
- Local Windows execution
- Memory
- MCP tools
- Artifacts
- Scheduler
- Notifications
- Permissions and approvals
- Evaluator
- Long-running workflows

## MVP
1. Android/web chat
2. Fastify API
3. Agent Core
4. 9Router Model Gateway
5. PostgreSQL + pgvector
6. Redis + BullMQ
7. WebSocket
8. Windows Agent
9. Basic coding runtime
10. Projects/memory/artifacts
11. Permission/approval
12. Evaluator

## Non-goals for MVP
- Kubernetes
- Local LLM infrastructure
- Multi-user SaaS
- Billing
- Enterprise IAM
- Massive distributed infrastructure

## Acceptance
The system must complete a representative workflow: user asks the agent to inspect a local project, diagnose a bug, modify code, run tests, evaluate results, and report progress/results to Android.
