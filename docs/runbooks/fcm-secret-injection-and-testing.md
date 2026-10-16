# Panduan Injeksi Secret FCM Service Account & Pengujian Push Android

Dokumen ini memandu langkah demi langkah penyuntikan kredensial Firebase Cloud Messaging (FCM) Service Account ke VPS produksi tanpa menyimpan secret di git repo, serta langkah pengujian push nyata ke ponsel Android fisik pengguna.

---

## 1. Menghasilkan Google Service Account Key

1. Buka [Firebase Console](https://console.firebase.google.com/) dan pilih proyek Personal AI OS (`personal-ai-os`).
2. Masuk ke **Project Settings** (ikon gerigi) -> tab **Service accounts**.
3. Pastikan runtime yang dipilih adalah **Firebase Admin SDK** (menggunakan API v1).
4. Klik tombol **Generate new private key** lalu konfirmasi popup.
5. Sebuah file JSON berformat `personal-ai-os-firebase-adminsdk-xxxxx.json` akan diunduh ke komputer Anda.

> [!CAUTION]
> **JANGAN PERNAH** meletakkan atau meng-commit file JSON ini ke dalam repository git atau direktori publik mana pun!

---

## 2. Menyuntikkan Secret ke Host VPS

1. Salin file JSON service account ke host VPS (misal via SCP atau SSH):
   ```bash
   scp personal-ai-os-firebase-adminsdk-xxxxx.json ubuntu@ai.ojixx.my.id:/tmp/fcm-key.json
   ```

2. Di host VPS, pindahkan file ke direktori konfigurasi aman `/etc/personal-ai-os/`:
   ```bash
   sudo mkdir -p /etc/personal-ai-os
   sudo mv /tmp/fcm-key.json /etc/personal-ai-os/fcm-service-account.json
   sudo chown ubuntu:ubuntu /etc/personal-ai-os/fcm-service-account.json
   sudo chmod 600 /etc/personal-ai-os/fcm-service-account.json
   ```

3. Daftarkan path secret pada file `.env` di VPS:
   ```bash
   # Di ~/apps/personal-ai-os/.env
   FCM_SERVICE_ACCOUNT_JSON=/etc/personal-ai-os/fcm-service-account.json
   ```

4. Konfigurasi `docker-compose.yml` (opsional untuk kontainerisasi):
   Pasang volume bind-mount pada service `api` dan `scheduler`:
   ```yaml
   volumes:
     - /etc/personal-ai-os/fcm-service-account.json:/etc/personal-ai-os/fcm-service-account.json:ro
   ```

---

## 3. Langkah Manual Pengujian di Perangkat Android

1. **Instal & Buka Aplikasi**:
   - Buka aplikasi **Personal AI OS** di ponsel Android Anda.
   - Saat aplikasi pertama kali meminta izin notifikasi (*Permission Request*), pilih **"Izinkan / Allow"**.

2. **Dapatkan Push Token Perangkat**:
   - Buka tab **Lainnya** -> gulir ke bagian **Lanjutan**.
   - Anda akan melihat status **ID Perangkat** dan **Push Token**.
   - Atau salin push token dari log aplikasi Android / respon `POST /v1/devices/:deviceId/push-token`.

3. **Kirim Pesan Uji dari Server**:
   Jalankan skrip uji push di VPS atau lokal (dengan token perangkat Android Anda):
   ```bash
   node --experimental-strip-types scripts/test-fcm-push.ts "<TOKEN_FCM_ANDROID_ANDA>"
   ```

4. **Verifikasi Visual**:
   - Dalam 1-3 detik, notifikasi sistem Android akan muncul di bilah status:
     - Judul: `🔔 Uji Notifikasi Personal AI OS`
     - Isi: `Notifikasi push Firebase Cloud Messaging (FCM) berhasil diterima di perangkat Android Anda!`
   - Mengetuk notifikasi akan membuka aplikasi langsung ke halaman obrolan (*deep link* `personal-ai://chat`).
