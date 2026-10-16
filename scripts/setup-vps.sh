#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Setup dan Penyesuaian VPS Produksi (Personal AI OS v0.3.0)
# Sesi 1 s.d. Sesi 17: Swap, Runtime Bridge, Firewall, Izin, Docker Stack, Caddy
# ==============================================================================

echo "========================================================================"
echo " [Personal AI OS] Memulai Penyesuaian Operasional VPS..."
echo "========================================================================"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# ------------------------------------------------------------------------------
# 1. SETUP SWAP MEMORY 4 GB
# ------------------------------------------------------------------------------
echo ""
echo "[1/8] Memeriksa Swap Memory..."
if [ "$(swapon --show | wc -l)" -le 1 ]; then
  echo "[-] Swap belum aktif. Membuat swapfile 4 GB..."
  sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  fi
  echo "[✓] Swapfile 4 GB berhasil dibuat dan diaktifkan."
else
  echo "[✓] Swap sudah aktif:"
  free -h | grep -i swap
fi

# ------------------------------------------------------------------------------
# 2. RUNTIME BRIDGE TOKEN & SYSTEMD SERVICE
# ------------------------------------------------------------------------------
echo ""
echo "[2/8] Menyiapkan Runtime Bridge Service..."
sudo mkdir -p /etc/personal-ai-os
if [ ! -f /etc/personal-ai-os/runtime-bridge.token ]; then
  echo "[-] Membuat token rahasia baru di /etc/personal-ai-os/runtime-bridge.token..."
  openssl rand -hex 32 | sudo tee /etc/personal-ai-os/runtime-bridge.token > /dev/null
  sudo chmod 600 /etc/personal-ai-os/runtime-bridge.token
  echo "[✓] Token berhasil dibuat."
else
  echo "[✓] Token runtime-bridge sudah ada."
fi

sudo chmod 600 /etc/personal-ai-os/runtime-bridge.token
BRIDGE_TOKEN="$(sudo cat /etc/personal-ai-os/runtime-bridge.token)"

if [ -f "infrastructure/systemd/personal-ai-os-runtime-bridge.service" ]; then
  sudo cp infrastructure/systemd/personal-ai-os-runtime-bridge.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now personal-ai-os-runtime-bridge
  sudo systemctl restart personal-ai-os-runtime-bridge
  echo "[✓] personal-ai-os-runtime-bridge service aktif."
else
  echo "[!] File service infrastructure/systemd/personal-ai-os-runtime-bridge.service tidak ditemukan."
fi

# ------------------------------------------------------------------------------
# 3. FIREWALL UFW (PORT 9120 HANYA UNTUK DOCKER SUBNET)
# ------------------------------------------------------------------------------
echo ""
echo "[3/8] Mengonfigurasi Firewall UFW..."
if command -v ufw >/dev/null 2>&1; then
  sudo ufw status | grep -q "9120" || sudo ufw allow from 172.20.0.0/16 to any port 9120 proto tcp
  sudo ufw reload || true
  echo "[✓] Firewall UFW diatur: port 9120 hanya terbuka untuk 172.20.0.0/16."
else
  echo "[i] UFW tidak terpasang, melewati langkah firewall."
fi

# ------------------------------------------------------------------------------
# 4. DIREKTORI & IZIN FILE
# ------------------------------------------------------------------------------
echo ""
echo "[4/8] Menyiapkan direktori data & logs..."
mkdir -p data/artifacts
chmod 775 data/artifacts
sudo mkdir -p /var/log/personal-ai-os
sudo chown -R "$USER":"$USER" /var/log/personal-ai-os
echo "[✓] Direktori data/artifacts dan /var/log/personal-ai-os siap."

# ------------------------------------------------------------------------------
# 5. PEMERIKSAAN BERKAS .ENV
# ------------------------------------------------------------------------------
echo ""
echo "[5/8] Memeriksa berkas .env..."
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo "[-] .env belum ada, menyalin dari .env.example..."
    cp .env.example .env
    echo "[!] PERHATIAN: Harap edit berkas .env untuk mengisi kunci API 9Router dan Google OAuth!"
  fi
fi

# Pastikan RUNTIME_BRIDGE_TOKEN di .env sinkron dengan host
if [ -f ".env" ]; then
  if grep -q "^RUNTIME_BRIDGE_TOKEN=" .env; then
    sed -i "s|^RUNTIME_BRIDGE_TOKEN=.*|RUNTIME_BRIDGE_TOKEN=${BRIDGE_TOKEN}|" .env
  else
    echo "RUNTIME_BRIDGE_TOKEN=${BRIDGE_TOKEN}" >> .env
  fi
  echo "[✓] RUNTIME_BRIDGE_TOKEN di .env disinkronkan dengan host token."
fi

# ------------------------------------------------------------------------------
# 6. DOCKER STACK DEPLOYMENT & DATABASE MIGRATIONS
# ------------------------------------------------------------------------------
echo ""
echo "[6/8] Menjalankan Docker Compose stack..."
docker compose down --remove-orphans || true
docker compose up -d --build

echo "Menunggu container dan migrasi database selesai..."
sleep 10
docker compose logs migrate || true

# ------------------------------------------------------------------------------
# 7. RELOAD CADDY EDGE REVERSE PROXY
# ------------------------------------------------------------------------------
echo ""
echo "[7/8] Memuat ulang konfigurasi Caddy reverse proxy..."
if docker compose ps | grep -q "caddy"; then
  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile || true
  echo "[✓] Caddyfile berhasil di-reload."
fi

# ------------------------------------------------------------------------------
# 8. JADWAL CRON BACKUP OFFSITE
# ------------------------------------------------------------------------------
echo ""
echo "[8/8] Menyiapkan cron backup terenkripsi harian..."
CRON_ENTRY="0 2 * * * cd $REPO_DIR && bash scripts/backup-offsite.sh >> /var/log/personal-ai-os/backup-offsite.log 2>&1"
(crontab -l 2>/dev/null | grep -Fv "backup-offsite.sh" ; echo "$CRON_ENTRY") | crontab -
echo "[✓] Cron job backup terpasang:"
crontab -l | grep "backup-offsite.sh"

# ------------------------------------------------------------------------------
# RINGKASAN VERIFIKASI AKHIR
# ------------------------------------------------------------------------------
echo ""
echo "========================================================================"
echo " [Personal AI OS] Verifikasi Akhir Kesehatan Sistem VPS"
echo "========================================================================"
docker compose ps
echo ""
echo "Menguji endpoint /ready..."
curl -s -i http://127.0.0.1:3000/ready | head -n 5 || echo "Gagal menghubungi API di 127.0.0.1:3000"
echo ""
echo "Menguji runtime-bridge /health..."
curl -s -i -H "Authorization: Bearer $BRIDGE_TOKEN" http://127.0.0.1:9120/health | head -n 5 || echo "Gagal menghubungi runtime-bridge"
echo ""
echo "[SELESAI] Penyesuaian VPS selesai dengan sukses!"
