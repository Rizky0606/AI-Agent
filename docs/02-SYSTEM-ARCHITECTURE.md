# Personal AI OS — System Architecture

## Architecture

Android / Web
    |
 HTTPS / WebSocket
    v
API Gateway
    |
    v
Agent Kernel
 |-- Intent Analyzer
 |-- Planner
 |-- Task Manager
 |-- Agent Router
 |-- Model Router
 |-- Context Manager
 |-- Memory Manager
 |-- Tool Manager
 |-- Runtime Manager
 |-- Permission Engine
 |-- Evaluator
 |-- Scheduler
 `-- Event Engine
    |
    +-- Agent Runtimes
    |   |-- Pi Adapter
    |   |-- OMP Adapter
    |   |-- Hermes Adapter
    |   `-- OpenHands Adapter
    |
    +-- Execution
    |   |-- Windows Agent
    |   |-- VPS Worker
    |   `-- Sandbox
    |
    +-- Research
    |   |-- Search
    |   |-- Crawl
    |   |-- Extract
    |   `-- Browser
    |
    `-- MCP Hub

## Infrastructure
- Ubuntu 24.04 ARM64
- Oracle Cloud ARM64, target 2 OCPU / 12 GB RAM
- Docker Compose
- Caddy
- PostgreSQL + pgvector
- Redis
- BullMQ
- OpenTelemetry
- Prometheus
- Grafana

## Principles
- Control plane separated from execution plane
- Provider/runtime agnostic abstractions
- Least privilege
- Durable task state
- Sandbox untrusted execution
- Verification before completion
