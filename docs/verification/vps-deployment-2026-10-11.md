# Verifikasi Deployment VPS — 2026-10-11

Host: Oracle Cloud ARM64 (aarch64), 2 OCPU, 11 GiB RAM tanpa swap, Ubuntu 24.04, Docker 29.8.2 / Compose v5.6.0.
Branch: `deploy/vps-setup` (commit terakhir: `7fe8246` fix worker guard, `660b358` merge origin/main).

## 1. Status Stack (docker ps)

```
personal-ai-os-api-1        Up (healthy)     3000/tcp
personal-ai-os-worker-1     Up (healthy)
personal-ai-os-scheduler-1  Up (healthy)
personal-ai-os-caddy-1      Up               127.0.0.1:8080->80/tcp
personal-ai-os-backup-1     Up
personal-ai-os-redis-1      Up (healthy)     6379/tcp (tidak dipublish)
personal-ai-os-postgres-1   Up (healthy)     5432/tcp (tidak dipublish)
personal-ai-os-migrate-1    Exited (0)       one-shot sukses
```

- `/health` → `{"status":"ok","service":"api"}`; `/ready` → database:true, redis:true.
- Image `linux/arm64` (docker image inspect).
- Memori idle: container total ±245 MiB; host 2.7Gi/11Gi used.

## 2. Smoke Test (LULUS/GAGAL)

| Skenario | Status | Bukti |
|---|---|---|
| Register/login/refresh/logout | LULUS | refresh reuse → 401; logout 204; refresh pasca-logout → 401 |
| Chat WS → 9Router | LULUS | `message.completed` "SMOKE_OK" (model dari DEFAULT_CHAT_MODEL), tersimpan di tabel `messages` |
| Task + worker + events WS + replay | LULUS | 6 task_events; replay via `lastEventId` mengirim `replayed=true` |
| HIGH → waiting_approval (approve/deny) | LULUS | approve → task `completed`; deny → task `failed`; re-decide → 400. **Butuh fix `7fe8246`** (guard tidak di-wire sebelumnya) |
| Worker restart recovery | LULUS | 2× restart, event counts tetap 1 per tipe, tanpa efek ganda |
| Schedules API | LULUS | create recurring → 201 active; delete → 200 (eksekusi cron belum diobservasi penuh) |
| Isolasi antar-akun | LULUS | akun B → project A: 404 |
| 401 tanpa token | LULUS | 7 endpoint: semua 401 |
| Backup + restore | LULUS | dump custom; pg_restore ke DB temp: 18 tabel, 3 users, 147 task_events; temp DB di-drop |

Catatan: `mockEnvironment` coding-track tidak dapat dikirim via REST (butuh fungsi, bukan JSON) — keterbatasan desain.

## 3. Keamanan Jaringan (ss -tulpn)

- Postgres/Redis **hanya** di jaringan Docker internal (`internal: true`); tidak ada listen di host: `docker port` kosong; `ss` tidak menampilkan 5432/6379 di host.
- Listen di 0.0.0.0 (host): 22 (sshd), 111 (rpcbind), 631 (cupsd), 80/443 (nginx), **9119 (hermes)**, 8000 (uvicorn).
- `127.0.0.1:8080` = Caddy (docker-proxy); `127.0.0.1:5432` = postgres host lama (bukan milik stack).
- **Risiko Hermes 9119 di 0.0.0.0**: tergantung Oracle Security List; jika terbuka, siapa pun dapat memanggil daemon. Usulan: bind 127.0.0.1 atau batasi NSG. Belum diubah (perlu persetujuan).
- `docker compose restart` penuh: semua service kembali Up/healthy.

## 4. Docker daemon

- `systemctl is-enabled docker` → enabled (aktif saat boot).
- Tidak ada `/etc/docker/daemon.json` → log tanpa rotasi. Usulan (belum diterapkan):
  ```json
  { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
  ```

## 5. Oracle Security List / NSG yang perlu dilakukan manual

- **Terbuka diperlukan**: 22 (SSH, batasi ke IP admin), 80/443 (nginx).
- **Tutup / jangan buka**: 9119 (Hermes), 8000, 111, 631, 8080 — semuanya cukup lewat localhost/SSH tunnel.
- Sementara ekspos publik belum ada: akses API via SSH tunnel `ssh -L 8080:127.0.0.1:8080 vps`.

## 6. Runtime Hermes/omp (laporan, tidak diaktifkan)

`OmpRuntimeAdapter` (`packages/agent-core/src/runtimes/omp-adapter.ts`) menjalankan **binary lokal** via `execFile('omp', ...)`. Di dalam container worker, binary host tidak tersedia. Opsi integrasi bila nanti diinginkan:
1. Panggil Hermes API lewat `host-gateway` (add `extra_hosts: host-gateway:host-gateway` di compose, base URL `http://host-gateway:9119`) + autentikasi token. Risiko: memperluas permukaan akses container → host; 9119 kini listen 0.0.0.0 sehingga container bisa menjangkau.
2. Install binary omp di image worker. Risiko: duplikasi state/kredensial agent di container.
3. Runtime SSH sidecar. Risiko tinggi, tidak disarankan.

Keputusan menunggu owner; tidak ada integrasi diaktifkan.

## 7. Data uji

Akun smoke (`smoke-a/b-*`, `smoke-test-a/b@example.com`) dihapus dari DB. Dump backup tetap tersimpan di volume `personal-ai-os_postgres-backups`.
