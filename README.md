# Personal AI OS

> Asisten AI pribadi yang menyatukan obrolan, memori, coding, riset, otomasi browser, tools/MCP, eksekusi lokal Windows, penjadwal/event, tugas durable ber-checkpoint, persetujuan risiko, evaluator berbasis bukti, dan observabilitas terdistribusi.

"Satu asisten, banyak kemampuan" — Pengguna cukup menyampaikan tujuan dalam bahasa natural; sistem mengatur konteks, rencana, model, runtime, tools, izin, evaluasi, dan pemulihan status secara otonom dan aman.

---

## 🏛️ Arsitektur Sistem & Peran Platform

Sistem dirancang dengan pemisahan batas tanggung jawab (*separation of concerns*) dan isolasi keamanan yang ketat:

- **Android Client (`apps/android`)**: Klien AI mobile penuh berbasis React Native + Expo (bukan sekadar remote control). Menyediakan obrolan interaktif, pemilih model & runtime cerdas, persetujuan risiko bertingkat (*risk approvals*), pemantauan tugas & artefak *realtime*, serta manajemen memori, skill, dan MCP.
- **Windows Agent (`apps/windows`)**: Aplikasi desktop lokal berbasis Tauri 2 + React + Rust. Berfungsi sebagai worker lokal dengan capability terbatas (PowerShell, file allowlist, status sistem) dengan keystore aman berbasis Windows DPAPI dan kurva P-256 murni di Rust.
- **Oracle Cloud VPS Control Plane (`apps/api`, `apps/agent-worker`, `apps/scheduler`)**:
  - **API (`apps/api`)**: Fastify REST + WebSocket gateway, JWT + PKCE authentication, event distribution, model resolution.
  - **Agent Worker (`apps/agent-worker`)**: Pemroses tugas durable berbasis BullMQ, eksekutor generic loop, integrasi Playwright headless Chromium, dan penghubung runtime eksternal.
  - **Scheduler (`apps/scheduler`)**: Cron scheduler otomatis, deduplikasi event, dan notifikasi berulang via FCM/Telegram.
- **9Router Gateway (`https://9router.ojixx.my.id/v1`)**: Satu-satunya pintu gerbang model LLM. Semua pemanggilan model dilakukan murni dari backend server; klien tidak pernah memegang API key eksternal.
- **Runtime Bridge (`apps/runtime-bridge`)**: Jembatan loopback HTTP terisolasi di VPS (port 9120) untuk mengeksekusi agen coding berat (OMP dan Hermes-agent) tanpa hak istimewa berlebih.

---

## 🛠️ Tech Stack Monorepo

| Lapisan / Modul | Teknologi & Library |
| :--- | :--- |
| **Workspace & Tooling** | pnpm workspace, Turborepo, TypeScript strict, ESLint 9, Prettier |
| **Backend & API** | Node.js (>=22), Fastify, Drizzle ORM, WebSocket, Zod |
| **Database & Queue** | PostgreSQL + pgvector, Redis, BullMQ |
| **Observability & Ops** | OpenTelemetry W3C traceparent, custom redaction, Telegram alert, Caddy edge proxy |
| **Desktop Client** | Tauri 2, Rust (windows-sys, p256, DPAPI), React 18, Vite |
| **Mobile Client** | React Native 0.76, Expo 52, React Navigation 7, Zustand, lucide-react-native |
| **Design System** | `@personal-ai-os/shared/design`, Inter typography, Dark & Light WCAG AA/AAA tokens |

---

## 🚀 Panduan Memulai Cepat (Local Development)

### Prasyarat
- Node.js >= 22
- pnpm >= 10.13.1
- PostgreSQL (port 5432) & Redis (port 6379) opsional untuk pengujian live backend

### Instalasi Dependensi
```bash
pnpm install
```

### Menjalankan Server Pengembangan
```bash
# Menjalankan seluruh workspace (API, worker, scheduler, windows, android)
pnpm dev

# Atau menjalankan layanan tertentu:
pnpm --filter @personal-ai-os/api dev
pnpm --filter @personal-ai-os/windows dev
pnpm --filter @personal-ai-os/android start
```

---

## 🧪 Gerbang Kualitas & Verifikasi Otomatis

Seluruh repositori dilindungi oleh gerbang kualitas (*quality gates*) terpadu yang memverifikasi lint, typecheck, seluruh test suite (665 pengujian: 656 lulus, 0 gagal, 9 dilewati bersyarat), build produksi, dan audit integritas referensi:

```bash
# Menjalankan seluruh gerbang kualitas sekaligus:
pnpm test:ci

# Verifikasi langkah per langkah:
pnpm -r lint        # ESLint strict di 14 package & app
pnpm -r typecheck   # TypeScript check tanpa emisi error
pnpm -r test        # Seluruh test suite (shared, permissions, model, api, worker, windows, android)
pnpm -r build       # Build bundle Vite (Windows) dan Expo export (Android)
pnpm verify:audit   # Verifikasi integritas dokumen audit
```

### Pengujian Pemulihan Khusus (Recovery Drills):
```bash
# Uji pemulihan tugas crash -> checkpoint resume against live Postgres & Redis:
pnpm --filter @personal-ai-os/agent-worker test:recovery
```

---

## 📦 Rilis & Pemasangan Installer

Lihat dokumentasi lengkap di:
- [Panduan Instalasi Aplikasi (Android APK & Windows NSIS)](docs/runbooks/install-apps.md)
- [Prosedur Deployment & Kapasitas VPS](docs/runbooks/deployment.md)
- [Laporan Penerimaan & Status Rilis 0.4.0](docs/capability-acceptance-report.md)
- [Matriks Kemampuan Lengkap (Capability Matrix)](docs/capability-matrix.yaml)
- [Catatan Perubahan Versi (CHANGELOG)](CHANGELOG.md)

---

## 🛡️ Kebijakan Keamanan & Privasi

1. **Zero Client Secrets**: Tidak ada secret, token VPS, ataupun model API key yang disimpan di klien, di-commit ke Git, atau diekspos di webview.
2. **Permission Engine**: Setiap aksi yang memiliki dampak nyata (akses file di luar direktori, modifikasi sistem, eksekusi tool berisiko) wajib melewati `PermissionEngine`. Tindakan level `HIGH` dan `CRITICAL` wajib disetujui secara eksplisit oleh pengguna melalui dialog konfirmasi modal.
3. **Redaksi Log & Jejak**: Seluruh trace OpenTelemetry, audit log, dan error report otomatis menyensor token otorisasi, password, kunci pribadi, serta credential menggunakan filter ekspresi reguler komprehensif.
4. **Batas Putaran Otonom**: Setiap loop otonom dibatasi secara ketat oleh `maxSteps` (maksimal 20), `timeoutMs`, dan batasan token untuk mencegah konsumsi sumber daya tanpa batas.

---

## 📄 Lisensi

Hak Cipta © 2026 Personal AI OS Contributors. Proyek ini dikembangkan secara privat untuk asisten AI pribadi berkeamanan tinggi.
