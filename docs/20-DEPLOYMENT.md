# Deployment Specification

## Target
Oracle Cloud ARM64 VM:
- Ubuntu 24.04 ARM64
- 2 OCPU
- 12 GB RAM
- Docker Compose

## Services
- Caddy
- API
- Agent Worker
- Scheduler
- MCP Gateway
- PostgreSQL
- Redis
- Prometheus
- Grafana

## Network
Public:
- HTTPS API
- WSS endpoint

Private/internal:
- PostgreSQL
- Redis
- internal workers

## Reverse Proxy
Caddy terminates TLS and routes:
- api
- websocket
- optional web frontend

## Backups
PostgreSQL backups must be automated.
Configuration/secrets must have secure backup/recovery procedures.

## Deployment
GitHub Actions -> build/test -> image -> VPS deployment.

## MVP Rule
Do not introduce Kubernetes until operational complexity actually requires it.
