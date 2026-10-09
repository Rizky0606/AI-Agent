# Verifikasi 9Router

Tanggal assessment: 2026-10-09 (Asia/Jakarta)  
Endpoint: `https://9router.ojixx.my.id/v1`

## Hasil nyata

| Kemampuan                           | Status      | Bukti / batasan                                                                                                             |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Konektivitas HTTPS ke `GET /models` | tersedia    | Probe menerima respons HTTP `401`; DNS, TLS, dan HTTP endpoint dapat dijangkau. Respons ini bukan bukti key valid.          |
| Autentikasi bearer                  | belum diuji | Tidak ada `NINEROUTER_API_KEY` atau `NINE_ROUTER_API_KEY` di environment proses assessment.                                 |
| Daftar model                        | belum diuji | Membutuhkan bearer key; model tidak boleh diasumsikan dari dokumen rencana.                                                 |
| Streaming                           | belum diuji | Probe billable tidak dijalankan tanpa key, model eksplisit, dan opt-in biaya.                                               |
| Tool calling                        | belum diuji | Sama; tidak boleh dipromosikan sebagai capability sebelum respons tool-call nyata diterima.                                 |
| Vision                              | belum diuji | Sama; perlu model vision yang dipilih eksplisit.                                                                            |
| Context window                      | belum diuji | Tidak ada metadata model terautentikasi. Probe tidak mengirim konteks besar karena berbiaya dan tidak aman sebagai default. |
| Rate limit                          | belum diuji | Respons `401` tidak membawa header rate-limit. Tidak dilakukan load test terhadap gateway bersama.                          |
| Usage / biaya                       | belum diuji | Tidak ada completion terautentikasi yang dapat diperiksa untuk `usage` atau metadata harga.                                 |

## Skrip reproducible

Skrip [verify-9router.ts](../../scripts/verify-9router.ts) tidak menyimpan atau mencetak API key. Mode default hanya menguji konektivitas dan **tidak** mengirim completion yang dapat ditagih.

```powershell
$env:NINEROUTER_API_KEY = 'key-dari-secret-manager-atau-session-env'
node --experimental-strip-types scripts/verify-9router.ts
```

Untuk menguji endpoint inference, tetapkan model yang memang disetujui dan opt-in eksplisit terhadap biaya:

```powershell
$env:NINEROUTER_TEST_MODEL = 'model-id-dari-GET-models'
$env:NINEROUTER_ALLOW_BILLABLE_PROBES = 'true'
node --experimental-strip-types scripts/verify-9router.ts
```

Keluaran JSON merekam status HTTP, header rate-limit yang ada, field metadata model, `usage`, dan `cost`/`costs`/`pricing` bila provider mengirimkannya. Simpan keluaran itu sebagai artefak internal yang telah direview; jangan memasukkan key maupun isi percakapan sensitif ke dokumen ini.

## Kriteria penerimaan ulang

- `GET /models` dengan key valid menghasilkan daftar model dan field capability/context yang nyata.
- Streaming menerima sedikitnya satu chunk non-kosong dan `content-type` direkam.
- Tool calling menghasilkan `tool_calls` atau kegagalan kompatibilitas yang terdokumentasi.
- Vision menjawab request gambar 1×1 yang dikirim script.
- Completion sederhana mengungkap apakah token usage dan biaya tersedia.
- Header rate-limit, atau ketiadaannya, dicatat dari respons sukses.

Hasil saat ini tidak membuktikan kompatibilitas OpenAI penuh; hanya keterjangkauan endpoint tanpa kredensial.
