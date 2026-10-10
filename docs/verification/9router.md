# Verifikasi 9Router — 2026-10-10

Sumber: `node --experimental-strip-types scripts/verify-9router.ts` dijalankan di VPS (servernic) dengan `NINEROUTER_API_KEY` dari `.env` (key tidak dicetak). Endpoint: `https://9router.ojixx.my.id/v1`.

## Hasil probe otomatis
| Probe | Status | Bukti |
| --- | --- | --- |
| Connectivity | available | `GET /models` tanpa auth → HTTP 401 (server hidup) |
| Authentication + model list | available | `GET /models` dengan key → HTTP 200, 257 model, fields `id`,`object`,`owned_by` |
| Streaming | SKIPPED | butuh `NINEROUTER_ALLOW_BILLABLE_PROBES=true` (berbayar) |
| Tool calling | SKIPPED | idem |
| Vision | SKIPPED | idem |
| Usage/cost metadata | SKIPPED | idem |
| Context window | inconclusive | tidak diuji (prompt besar = biaya) |
| Rate limits | inconclusive | tidak ada header rate-limit pada respons |

## Kandidat DEFAULT_CHAT_MODEL (dari daftar model, belum diuji inference)
- `or/anthropic/claude-sonnet-4-6` / `-4.5`, `or/anthropic/claude-opus-4.6`…`-5.5`, `or/anthropic/claude-haiku-4.5`, `or/anthropic/claude-fable-5`/`-5.1`
- `or/deepseek/deepseek-chat`, `or/deepseek/deepseek-reasoner`, `or/google/gemini-3.5-flash`, `or/openai/gpt-4o(-mini)`
- Gratis: `agentic/deepseek-v4.1-flash-free`, `agentic/muse-spark-1.3-free`, `agentic/qwen3.8-flash-free`

## Keputusan menunggu pemilik
1. `DEFAULT_CHAT_MODEL` belum diisi. Rekomendasi: `or/anthropic/claude-sonnet-4-6` (chat+streaming), atau `agentic/deepseek-v4.1-flash-free` jika ingin tanpa biaya.
2. Streaming/tool-calling/vision belum terverifikasi nyata. Untuk menguji: set `NINEROUTER_ALLOW_BILLABLE_PROBES=true` lalu jalankan ulang verify (perkiraan biaya kecil, beberapa request inference tunggal).
