# Panduan & Prompt Penyesuaian Operasional VPS (Sesi 1 s.d. Sesi 17)

Panduan ini berisi seluruh instruksi dan perintah idempoten untuk menyesuaikan sistem operasi host, swap memory, firewall, izin direktori, environment variables (`.env`), systemd service, dan container stack di VPS Oracle Cloud Ubuntu 24.04 ARM64.

---

## Ringkasan Hal yang Wajib Disesuaikan di VPS

1. **Swap Memory 4 GB** (Melindungi dari kernel Linux OOM Killer).
2. **Runtime Bridge Token & Systemd** (Menghubungkan container worker dengan OMP/Hermes di host).
3. **Firewall UFW** (Membuka port 9120 hanya untuk subnet Docker `172.20.0.0/16`).
4. **Environment Variables (`.env`)** (Mengisi secret asli: 9Router API key, Google OAuth PKCE, Token Bridge, Telegram Bot, dan Policy Model).
5. **Direktori Artefak & Izin File** (`data/artifacts` dan `/var/log/personal-ai-os`).
6. **Deploy Docker Stack & Migrasi** (`docker compose up -d --build`).
7. **Reload Caddy Reverse Proxy** (Mengaktifkan security headers dan log rotation).
8. **Cron Job Backup Offsite Terenkripsi** (Menjalankan backup database otomatis).

---

## Langkah demi Langkah Penyesuaian di VPS

### Langkah 1: Periksa Status dan Tarik Kode Terbaru
Masuk ke direktori repositori di VPS dan pastikan branch `main` sudah sinkron:

```bash
cd ~/Coding/Project/AI-Agent || cd /home/ubuntu/AI-Agent || cd /srv/personal-ai-os
git fetch origin
git checkout main
git pull origin main
git log -n 3 --oneline
```

---

### Langkah 2: Setup Swap Memory 4 GB (Perlindungan OOM Killer)
VPS Oracle Cloud Ampere A1 bawaannya memiliki 0 Byte Swap. Buat swap file 4 GB secara aman jika belum aktif:

```bash
if [ $(swapon --show | wc -l) -le 1 ]; then
  echo "[+] Membuat Swap File 4 GB..."
  sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  fi
  echo "[✓] Swap 4 GB berhasil diaktifkan."
else
  echo "[i] Swap sudah aktif:"
  free -h
fi
```

---

### Langkah 3: Setup Runtime Bridge Systemd Service & Token (Sesi 13 & 14)
Worker Docker membutuhkan jembatan aman ke host untuk menjalankan OpenMP (`omp`) dan `hermes`:

1. Siapkan direktori dan file token rahasia (minimal 32 byte dengan izin `0600`):
   ```bash
   sudo mkdir -p /etc/personal-ai-os
   if [ ! -f /etc/personal-ai-os/runtime-bridge.token ]; then
     echo "[+] Membuat token rahasia runtime-bridge..."
     openssl rand -hex 32 | sudo tee /etc/personal-ai-os/runtime-bridge.token > /dev/null
     sudo chmod 600 /etc/personal-ai-os/runtime-bridge.token
   fi
   ```

2. Pasang unit systemd dan jalankan layanannya:
   ```bash
   sudo cp infrastructure/systemd/personal-ai-os-runtime-bridge.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now personal-ai-os-runtime-bridge
   sudo systemctl status personal-ai-os-runtime-bridge --no-pager
   ```

3. Catat nilai token untuk disalin ke file `.env`:
   ```bash
   BRIDGE_TOKEN=$(sudo cat /etc/personal-ai-os/runtime-bridge.token)
   echo "Nilai RUNTIME_BRIDGE_TOKEN Anda adalah: $BRIDGE_TOKEN"
   ```

---

### Langkah 4: Pengaturan Firewall UFW (Isolasi Jaringan Host)
Izinkan hanya subnet Docker internal (`172.20.0.0/16`) yang boleh mengakses port Runtime Bridge (9120):

```bash
sudo ufw status | grep 9120 || sudo ufw allow from 172.20.0.0/16 to any port 9120 proto tcp
sudo ufw reload
```

> **Peringatan Keamanan**: Pastikan port 9119 (Hermes) dan 8000 (OMP) **tidak** dibuka ke publik melalui UFW. Keduanya hanya boleh listening di localhost (`127.0.0.1`).

---

### Langkah 5: Setup Direktori Data & Izin File
Pastikan folder artefak dan folder log tersedia serta dapat ditulisi kontainer:

```bash
mkdir -p data/artifacts
chmod 775 data/artifacts
sudo mkdir -p /var/log/personal-ai-os
sudo chown -R $USER:$USER /var/log/personal-ai-os
```

---

### Langkah 6: Penyesuaian Berkas Konfigurasi `.env` Produksi
Buka berkas `.env` di VPS:

```bash
nano .env
```

Pastikan variabel-variabel kunci berikut sudah terisi sesuai nilai aslinya:

```env
# 1. Kredensial Database & Redis
POSTGRES_DB=personal_ai_os
POSTGRES_USER=personal_ai_os
POSTGRES_PASSWORD=ganti_dengan_password_db_vps_anda
DATABASE_URL=postgresql://personal_ai_os:ganti_dengan_password_db_vps_anda@postgres:5432/personal_ai_os
REDIS_URL=redis://redis:6379
JWT_SECRET=ganti_dengan_string_rahasia_minimal_32_karakter

# 2. 9Router Model Gateway (Sesi 5)
NINEROUTER_BASE_URL=https://9router.ojixx.my.id/v1
NINEROUTER_API_KEY=nr-kunci_api_9router_anda
AUTO_MODEL_DEFAULT=google/gemini-2.5-flash
AUTO_MODEL_FAST=google/gemini-2.5-flash
AUTO_MODEL_CODING=anthropic/claude-3-7-sonnet
AUTO_MODEL_COMPLEX=anthropic/claude-3-7-sonnet
AUTO_MODEL_RESEARCH=openai/gpt-4o

# 3. Google Sign-in PKCE (Sesi 3)
GOOGLE_CLIENT_ID=client_id_google_anda.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=client_secret_google_anda
GOOGLE_REDIRECT_URI=https://ai.ojixx.my.id/v1/auth/google/callback
GOOGLE_ALLOWED_REDIRECT_URIS=personal-ai://auth

# 4. Runtime Bridge (Sesi 13 - Samakan dengan nilai dari Langkah 3)
RUNTIME_BRIDGE_URL=http://host.docker.internal:9120
RUNTIME_BRIDGE_TOKEN=tempelkan_BRIDGE_TOKEN_dari_langkah_3

# 5. Telegram Alerting (Sesi 16 - Opsional tapi direkomendasikan)
TELEGRAM_ALERT_BOT_TOKEN=token_bot_dari_botfather_anda
TELEGRAM_ALERT_CHAT_ID=id_chat_telegram_anda
TELEGRAM_ALERT_COOLDOWN_MS=300000

# 6. Offsite Encrypted Backup (Sesi 16)
OFFSITE_BACKUP_ENCRYPTION_KEY=frasa_sandi_rahasia_aes256_bebas

# 7. Domain & Caddy
PUBLIC_HOSTNAME=ai.ojixx.my.id
ACME_EMAIL=email_anda@example.com
```

---

### Langkah 7: Deploy Docker Stack & Jalankan Migrasi
Jalankan stack Docker Compose. Layanan `migrate` akan otomatis mengeksekusi seluruh migrasi database hingga skema terbaru (`0014_skills_and_mcp.sql`):

```bash
docker compose down --remove-orphans
docker compose up -d --build
```

Periksa log migrasi database untuk memastikan seluruh tabel berhasil dibuat/diperbarui:
```bash
docker compose logs migrate
```

---

### Langkah 8: Reload Caddy Reverse Proxy
Muat ulang konfigurasi Caddy agar header keamanan terbaru (HSTS, CSP, nosniff, frame-ancestors DENY, log rotation) aktif:

```bash
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

### Langkah 9: Jadwalkan Cron Backup Terenkripsi Offsite (Sesi 16)
Jadwalkan backup database otomatis setiap pukul 02:00 dini hari:

```bash
CRON_JOB="0 2 * * * cd $(pwd) && bash scripts/backup-offsite.sh >> /var/log/personal-ai-os/backup-offsite.log 2>&1"
(crontab -l 2>/dev/null | grep -Fv "backup-offsite.sh" ; echo "$CRON_JOB") | crontab -
crontab -l | grep "backup-offsite.sh"
```

---

### Langkah 10: Verifikasi Kesehatan Sistem
Jalankan tes verifikasi endpoint dan tampilkan bukti statusnya:

1. **Status Kontainer**:
   ```bash
   docker compose ps
   ```
   *(Pastikan kontainer `api`, `worker`, `scheduler`, `postgres`, `redis`, dan `caddy` dalam status `running` atau `healthy`).*

2. **Kesiapan Backend Internal**:
   ```bash
   curl -i http://127.0.0.1:3000/ready
   ```
   *(Harus mengembalikan HTTP 200 OK).*

3. **Kesiapan Publik via Caddy HTTPS**:
   ```bash
   curl -i https://ai.ojixx.my.id/ready
   ```
   *(Harus mengembalikan HTTP 200 OK beserta header keamanan HSTS).*

4. **Kesehatan Runtime Bridge di Host**:
   ```bash
   curl -i -H "Authorization: Bearer $(sudo cat /etc/personal-ai-os/runtime-bridge.token)" http://127.0.0.1:9120/health
   ```
   *(Harus mengembalikan HTTP 200 OK).*

5. **Kapasitas Memori & Disk Host**:
   ```bash
   free -h
   df -h /
   ```
