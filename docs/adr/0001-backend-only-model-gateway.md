# ADR 0001: Model gateway hanya di backend

Status: accepted  
Tanggal: 2026-10-09

## Konteks

Produk menargetkan Android, web, worker Windows, dan control plane. 9Router adalah satu-satunya gateway model dan API key harus tetap server-side.

## Keputusan

Semua panggilan 9Router dilakukan oleh layanan backend/control plane melalui satu abstraksi `ModelGateway`. Klien Android/web dan Windows worker tidak menerima key gateway. Backend menyimpan metadata provider/model, latency, token usage, estimasi biaya, dan outcome request yang sudah disanitasi.

Capability model tidak di-hardcode sebagai fakta produk. Ia hanya diaktifkan setelah verifikasi terautentikasi dan disimpan sebagai capability registry berumur terbatas.

## Konsekuensi

- Memusatkan redaksi secret, retry terbatas, observability, dan circuit breaker.
- Menambah hop jaringan dan menjadikan gateway backend komponen kritis yang harus punya perilaku outage yang eksplisit.
- Model/capability discovery menjadi prasyarat sebelum vision, tool calling, atau long-context diaktifkan di UX.
