# ADR 0003: AI Council dan Judge Berbasis Bukti dengan Batasan Ketat

Status: accepted  
Tanggal: 2026-10-10

## Konteks

Dalam sistem multi-agent, sering muncul ide AI Council (konsensus Multi-LLM) di mana beberapa persona agent berdebat sebelum mengambil keputusan.
Namun, pada lingkungan komputasi riil:

1. VPS control plane memiliki baseline resource terbatas (Oracle Cloud ARM64 2 OCPU / 12 GB RAM).
2. Panggilan model melalui 9Router memiliki latensi jaringan, biaya token, dan kuota rate limit.
3. Debat multi-agent tanpa verifikasi empiris (ground truth) rentan terhadap _amplified hallucination_, di mana agent saling memvalidasi argumen yang secara faktual salah atau tidak teruji.
4. Mayoritas task (chat, coding, research terfokus, eksekusi tool) diselesaikan lebih cepat, lebih murah, dan lebih deterministik oleh single specialized agent yang dipandu acceptance criteria dan Evaluator.

## Keputusan

1. **Tunda AI Council untuk alur kerja rutin**: Tugas harian, coding standar, dan alur riset biasa TIDAK menggunakan AI Council. Eksekusi tetap didelegasikan ke runtime spesifik (OMP, Pi, Coding Agent, Research Agent).
2. **AI Council dibatasi ketat (opsional hanya untuk high-stakes review)**:
   - Maksimal peserta: $\le 3$ persona (misal: Security Reviewer, Architecture Reviewer, Performance/Reliability Reviewer).
   - Maksimal putaran (rounds): $\le 2$ putaran (Putaran 1: telaah & kritik, Putaran 2: rekonsiliasi & sintesis).
   - Batas biaya & token: Maksimal $0.10 USD per deliberasi dan hard cap 16.000 token.
   - Timeout ketat: Maksimal 30 detik.
3. **Judge Berbasis Bukti (Evidence-Based Judge)**:
   - Keputusan akhir tidak ditentukan oleh pemungutan suara mayoritas (voting).
   - Judge menimbang bukti empiris (`EvidenceItem`: hasil test nyata, static analysis, linter, security scan, diff audit).
   - Argumen atau opini yang tidak memiliki bukti verifikasi otomatis ditolak atau diberi bobot rendah dibandingkan bukti tes yang lulus/gagal.
4. **Self-Healing Berdiri Sendiri**: Mekanisme pemulihan kegagalan (self-healing) dijalankan secara bounded deterministik (detect $\rightarrow$ collect $\rightarrow$ diagnose $\rightarrow$ propose $\rightarrow$ permission $\rightarrow$ apply $\rightarrow$ test $\rightarrow$ verify $\rightarrow$ stop/rollback/escalate) tanpa memerlukan council untuk setiap iterasi perbaikan.

## Konsekuensi

- Menghemat konsumsi token dan menjaga latensi pada batas wajar di VPS 2 OCPU.
- Mencegah loop perdebatan tanpa akhir (_infinite debate loops_).
- Menjamin setiap keputusan berisiko tinggi selalu bersandar pada bukti nyata (_evidence over opinion_), selaras dengan aturan kerja nomor 7 pada `AGENTS.md`.
