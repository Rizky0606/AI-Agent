# ADR 0002: Control plane terpisah dari execution plane

Status: accepted  
Tanggal: 2026-10-09

## Konteks

Personal AI OS menjalankan tindakan dengan dampak beragam: chat, browser, filesystem, terminal, Git, dan runtime eksternal. Windows worker dapat offline, sedangkan VPS menjalankan control plane.

## Keputusan

Control plane VPS menjadi pemilik identitas, task state durable, policy/approval, scheduler, audit event, dan dispatch. Windows worker, sandbox, browser runner, serta adapter runtime adalah execution plane ber-capability terbatas. Mereka menerima work order bertanda tangan/berumur pendek dan mengembalikan event/artifact; mereka tidak membuat keputusan approval sendiri.

Tindakan HIGH/CRITICAL harus memiliki approval server-side yang masih valid tepat sebelum dispatch. Retry, lease, cancellation, dan idempotency key wajib ada pada protokol task sebelum pekerjaan otonom dibuat.

## Konsekuensi

- Offline worker dapat direkonsiliasi tanpa mengorbankan audit dan kebijakan pusat.
- Desain awal membutuhkan schema task/event dan mekanisme outbox/worker lease sebelum integrasi tool yang berdampak.
- Detail UX offline, TTL work order, dan conflict policy tetap keputusan terbuka dan harus disahkan sebelum implementasi Windows worker.
