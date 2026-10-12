# Live Runtime Probe — 2026-10-11

VPS only; read-only probes. No provider keys printed.

## OMP

- `omp --version`: `omp/18.6.1` / `omp v18.6.1` — verified.
- `omp --help`: `-p/--print` non-interactive; `--mode text|json|rpc|rpc-ui`; `--max-time`; `--no-session`; model flags. — verified.
- `omp -p 'balas hanya: OK' --mode json --no-session`: exit 0. JSONL event stream (not one object): `session`, `agent_start`, `turn_start`, `message_start`, `message_end`, `message_update`, `turn_end`, `agent_end`. Assistant message fields: `role`, `content:[{type:'text',text:'OK'}]`, `api`, `provider:'router9'`, `model:'Gratisan'`, `usage:{input,output,totalTokens,...}`, `stopReason`, `duration`, `ttft`. Final assistant event contained 6,577 input / 5 output / 6,582 total tokens; actual answer `OK`. Output raw captured by tool; no secret.
- `/usr/bin/time -v`: maximum RSS **388,012 KiB**, elapsed 24.86s, exit 0.
- Invalid model `--model provider/nonexistent-model`: exit **1**; no stdout; max RSS **402,880 KiB**, elapsed 2.79s.
- `--max-time 1`: terminated after ~2.15s by external `timeout 1` (exit 124). This wrapper test confirms it was not accepted as reliable hard process limit at startup; bridge must enforce its own process-group timeout. [Not independently measured OMP internal timeout exit semantics].
- `~/.omp/agent/config.yml` exists; first keys are `modelRoles:`. No config contents/secrets copied. Live response reports `provider=router9`, model `Gratisan`, so 9Router selected for this invocation — verified. Exact provider configuration resolution precedence not fully inspected.
- `--mode rpc`: documented in CLI help only; **not run**, not activated. Protocol/handshake not verified; do not use until separately probed.

## Hermes CLI

- `hermes --version`: Hermes Agent `v0.20.5` (2026.8.19).
- `hermes --help`: global `-z PROMPT`; `chat` interactive subcommand; noninteractive `-z` verified.
- `hermes -z 'balas hanya: OK' --no-restore-cwd --safe-mode`: stdout exactly `OK`, exit 0. `/usr/bin/time -v`: max RSS **160,356 KiB**, elapsed 19.64s.
- Therefore host Hermes CLI supports non-interactive prompt execution. Exact output is plain text, not structured JSON. Provider/model for this invocation was not independently verified.

## Hermes daemon HTTP

Daemon URL `http://127.0.0.1:9119` (loopback; port bind verified separately).

| Probe | Result |
|---|---|
| `GET /` | 200 `text/html`, dashboard SPA |
| `GET /health` | 200 `text/html`, same SPA fallback; not a JSON health endpoint |
| `GET /docs` | 200 Swagger UI |
| `GET /openapi.json` | 200, OpenAPI 3.1.0, Hermes Agent 0.20.5 |
| `/api/health` | documented GET, lightweight liveness |
| prompt API | OpenAPI paths search found no chat/prompt execution endpoint; `/api/chat/image-upload` is upload-only. Not verified to accept prompts over HTTP. |

No auth scheme declared globally in OpenAPI. No prompt HTTP request attempted. No service token searched or read. Dashboard/API auth requirements remain unknown.

## Decision

- `omp` and `hermes` are both usable non-interactively as **host CLIs**, so a bridge can invoke binaries locally; enforce timeout externally and parse OMP JSONL/plain Hermes text carefully.
- Do **not** use Hermes daemon HTTP for prompts: no verified prompt endpoint/auth contract.
- Runtime output is untrusted. Do not execute returned actions absent Permission Engine evaluation.
- Safe bridge installation requires binding specifically to Docker network gateway address and firewall limiting source to compose subnet. Need install approval for unit; firewall changes await owner approval.
