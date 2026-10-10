# Verifikasi 9Router — 2026-10-10

Sumber: `scripts/verify-9router.ts` + probe manual curl di VPS (servernic), key dari `.env` (tidak pernah dicetak). Endpoint: `https://9router.ojixx.my.id/v1`.

## Hasil probe otomatis (scripts/verify-9router.ts)
| Probe | Status | Bukti |
| --- | --- | --- |
| Connectivity | available | `GET /models` tanpa auth → HTTP 401 (server hidup) |
| Authentication + model list | available | `GET /models` dengan key → HTTP 200, 257 model |
| Streaming/tool/vision (billable) | skipped oleh skrip | butuh `NINEROUTER_ALLOW_BILLABLE_PROBES=true` |

## Probe manual per model (2026-10-10)
Kategori provider `zrouter/` (pilihan pemilik): chat/streaming/tool/vision → **HTTP 402 `insufficient_balance`** pada `zrouter/gpt-5.6-terra`, `zrouter/gemini-3.8-flash`, `zrouter/deepseek-v4.1-flash`, `zrouter/glm-5.3-flash`. Akun perlu top-up PAYG/Token Plan untuk semua model berbayar.

Model gratis lain:
| Model | Chat | Streaming | Tool calling | Vision |
| --- | --- | --- | --- | --- |
| `agentic/space-bunny-free` | OK (jawab "OK") | OK (9 chunks, SSE, [DONE]) | OK (`tool_calls` get_weather{"city":"Jakarta"}, finish_reason=tool_calls) | TIDAK (model menyatakan no vision support) |
| `agentic/deepseek-v4.1-flash-free` | 429 `free_shared_pool_exhausted` (kuota harian global habis, reset 00:00 WIB) | — | — | — |
| `agentic/qwen3.8-flash-free` | 403 `model_not_available` di plan free | — | — | — |
| `hubmix/gemini-3.8-flash-free` | 404 `model_retired` | — | — | — |
| `hubmix/minimax-m3-free` | 400 `no_available_channel` | — | — | — |
| `or/google/gemini-3.5-flash` | 402 out of credits | — | — | — |

## Context window
- `/models` tidak menyediakan metadata context_length/context_window.
- Uji input panjang `agentic/space-bunny-free`: payload ~12.000 kata diterima, `usage.prompt_tokens=12975` tanpa error → setidaknya ~13k token berfungsi praktis. Batas atas tidak diuji (biaya/limit).

## Keputusan & rekomendasi
- **DEFAULT_CHAT_MODEL diset ke `agentic/space-bunny-free`** — satu-satunya model yang LULUS chat+streaming+tool calling saat ini (gratis, tanpa top-up). Catatan: melayani via `zen-space-bunny-free`, reasoning-heavy (output di `reasoning_content`).
- Vision: TIDAK tersedia pada model gratis yang hidup. Perlu top-up (mis. `zrouter/gemini-3.8-flash` atau `or/...`) bila fitur vision dibutuhkan.
- Rate limit: error 402/429 menyertakan "(reset after Xm)" — backoff per request, tanpa header rate-limit standar.
- Jalankan ulang probe: `sh scripts/.probe-zrouter.sh <model-id>` (helper lokal, tidak di-commit; hasil tetap terdokumentasi di sini).
