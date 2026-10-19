# Hasil Verifikasi Endpoint Embeddings 9Router — 2026-10-18

Tanggal: 18 Oktober 2026  
Lingkungan: Ubuntu 24.04 ARM64 VPS (`ubuntu@servernic`), direktori `~/apps/personal-ai-os`  
Variabel: `NINEROUTER_API_KEY` dan `NINEROUTER_BASE_URL` dimuat dari `.env`  
Gateway: `https://9router.ojixx.my.id/v1`

---

## 1. Hasil Probe Perintah

### 1.1 Probe Model `text-embedding-3-small`
Perintah:
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "${NINEROUTER_BASE_URL:-https://9router.ojixx.my.id/v1}/embeddings" \
  -H "Authorization: Bearer $NINEROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "text-embedding-3-small", "input": "tes verifikasi embedding"}'
```
Keluaran Aktual:
```json
{"error":{"message":"No credentials for provider: openai","type":"invalid_request_error","code":"bad_request"}}
HTTP_STATUS:400
```

### 1.2 Probe Penyaringan Model Embedding di `/v1/models`
Perintah:
```bash
curl -s "${NINEROUTER_BASE_URL:-https://9router.ojixx.my.id/v1}/models" \
  -H "Authorization: Bearer $NINEROUTER_API_KEY" | grep -o '"id":"[^"]*"' | grep -i "embed" || echo "Tidak ditemukan model embed"
```
Keluaran Aktual:
```text
Tidak ditemukan model embed
```

### 1.3 Probe Model Chat Sebagai Embedding (`zrouter/gpt-6-luna`)
Perintah:
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "${NINEROUTER_BASE_URL:-https://9router.ojixx.my.id/v1}/embeddings" \
  -H "Authorization: Bearer $NINEROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "zrouter/gpt-6-luna", "input": "tes verifikasi embedding"}'
```
Keluaran Aktual:
```json
{"error":{"message":"[openai-compatible-chat-8242d158-295f-40ec-94b4-db1d9bee7157/gpt-6-luna] [404]: 404 page not found\n (reset after 2m)"}}
HTTP_STATUS:404
```

---

## 2. Kesimpulan Empiris
1. **Endpoint embeddings 9Router masih tanpa kredensial provider upstream** (`No credentials for provider: openai`).
2. **Katalog model 9Router tidak memiliki model embedding aktif**.
3. Sesuai **Aturan Sesi 30 Tugas 1**:
   *"Jika masih tanpa kredensial, BERHENTI dan beri saya opsi dengan konsekuensi (menambah kredensial provider embedding di 9Router atau provider lain yang saya pilih). Jangan membuat provider palsu atau memakai model lokal di VPS."*
   Eksekusi dihentikan untuk meminta keputusan pemilik sistem.
