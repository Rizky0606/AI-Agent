# Runtime bridge runbook

Host-only bridge for verified CLI runtimes. Current evidence: `docs/verification/runtimes-live.md`.

## Configuration

Worker reads `RUNTIME_BRIDGE_URL`, `RUNTIME_BRIDGE_TOKEN`, `RUNTIME_PREFERRED`, and `RUNTIME_HEALTH_INTERVAL_MS`. Bridge defaults: `172.20.0.1:9120`, workspace `/srv/aios/workspaces`, token `/etc/personal-ai-os/runtime-bridge.token`, audit `/var/log/personal-ai-os/runtime-bridge.audit.jsonl`.

Token: random value, minimum 32 bytes, file mode `0600`; never print or commit it. Bridge rejects broader permissions.

## Installation gate

Do not install/start until the owner approves `infrastructure/systemd/personal-ai-os-runtime-bridge.service` diff. Do not modify firewall without separate approval.

Proposed rule only, not applied:

```sh
sudo ufw allow from 172.20.0.0/16 to any port 9120 proto tcp
```

Equivalent exact iptables proposal:

```sh
sudo iptables -I INPUT 1 -p tcp -s 172.20.0.0/16 --dport 9120 -j ACCEPT
```

## VPS activation record — 2026-10-11

- systemd unit enabled/active; bridge bound `172.20.0.1:9120`.
- UFW rule applied: TCP `9120` allowed from `172.20.0.0/16` only.
- Token file exists with owner `ubuntu:ubuntu`, mode `0600`; secret not displayed.
- `/health` authenticated: HTTP 200; invalid token: HTTP 401.
- Live Hermes run: completed, exit 0, output `OK`.
- Live OMP 18.6.1 run: completed, exit 0; JSONL output includes assistant response `OK`.
- Unit `ReadWritePaths` includes runtime state paths `/home/ubuntu/.omp/run`, `/home/ubuntu/.hermes/logs`; required because `ProtectHome=read-only` otherwise caused `EROFS`.
- VPS proof covers bridge-to-host-runtime only. Worker/API queue/evaluator end-to-end remains unverified.

No public bind. Compose egress inspection verified `172.20.0.0/16`, gateway `172.20.0.1`.

## Verification after approval

1. `pnpm --filter @personal-ai-os/runtime-bridge build`.
2. Create `/etc/personal-ai-os/runtime-bridge.token` mode `0600`; create workspace/log paths owned by `ubuntu` mode `0700`.
3. `systemctl daemon-reload`; enable/start unit.
4. Authenticated `/health`; wrong token must return `401`.
5. OMP and Hermes runs; inspect status/SSE/audit without exposing prompt or token.
6. Cancel and timeout; confirm process group termination.
7. Verify worker routing/fallback events and evaluator result.

Workspace manager initializes a project Git repository and checks out `task/<taskId>`. It never pushes, merges, or deploys. Runtime output remains untrusted; proposed actions pass Permission Engine. HIGH/CRITICAL actions remain approval-gated.
