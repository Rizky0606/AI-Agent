# ADR: Host Runtime Bridge

Status: proposed; implementation not deployable yet.

## Verified runtime contract

See `docs/verification/runtimes-live.md`. OMP 18.6.1 emits JSONL events using `--mode json`; Hermes 0.20.5 supports non-interactive `-z PROMPT` with plain-text output. Hermes HTTP prompt API is unverified; do not use it.

## Network boundary

Compose egress network `personal-ai-os_egress`: `172.20.0.0/16`, gateway `172.20.0.1`; worker address `172.20.0.4`. Proposed bridge bind: `172.20.0.1:9120`, reachable through Docker host-gateway only. Proposed host firewall rule: allow TCP 9120 from `172.20.0.0/16`; deny other sources. Do not apply until owner approves exact UFW/iptables commands. Existing INPUT default DROP; current user rules permit SSH from `129.225.32.153` and public 80/443.

## Installation gate

The systemd unit under `infrastructure/systemd/` is a draft only. Do not install/start until owner reviews its diff and approves. Runtime files and workspace directories need explicit ownership/permissions; `ProtectHome` must permit access to verified host CLI binaries and their provider configuration without inheriting project secrets. No firewall rule, systemd unit, bridge token, or workspace root has been installed by this ADR.

## Required implementation acceptance

- Token file mode 0600; constant-time authentication; rate limiting, bounded queue/output/timeout, process-group cancellation.
- Realpath containment and symlink/path traversal rejection, including workspace creation races.
- Minimal child environment; runtime configuration access documented and isolated.
- Workspace per project, branch per task; no push; proposed actions pass Permission Engine and HIGH/CRITICAL wait for approval.
- Audit events without prompt/output/token values.
- Unit tests for auth, symlink/traversal, secret environment isolation, timeout, cancellation, output bounds, queue serialization; fake CLI integration tests.
- Worker adapter registration/fallback and task-visible health state; integration only after owner approves systemd and firewall changes.
