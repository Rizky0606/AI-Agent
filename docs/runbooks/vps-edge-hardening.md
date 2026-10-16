# Panduan Pengerasan Edge VPS — Log Rotation, Rate Limiting, & Security Headers

Dokumen ini mendokumentasikan arsitektur proteksi edge pada VPS Personal AI OS (`ai.ojixx.my.id`), yang menghubungkan Nginx di host VPS dengan Caddy 2 reverse proxy di dalam container Docker.

---

## 1. Arsitektur Aliran Trafik

```
[Klien Luar (HTTPS:443)] 
         │
         ▼
[Nginx Host (ai.ojixx.my.id)] ── SSL Termination (Let's Encrypt Certbot)
         │ (HTTP proxy_pass ke 127.0.0.1:8080)
         ▼
[Caddy 2 Container (:80)] ───── Security Headers Injection & /v1/internal/* 404 blocking
         │ (internal Docker network 'edge')
         ▼
[Fastify API (api:3000)] ────── Fastify Rate Limit (100 req/min, 10 req/min auth)
```

---

## 2. Rotasi Log (Log Rotation)

Untuk mencegah disk VPS kehabisan ruang (*disk exhaustion*):

### A. Docker Daemon Logging (`/etc/docker/daemon.json`)
Rotasi log otomatis diterapkan untuk seluruh container:
```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```
Setiap container dibatasi maksimal 3 file log berukuran masing-masing 10 MB (total maksimal 30 MB per container).

### B. Caddy Reverse Proxy Log Rotation
Diatur dalam `infrastructure/caddy/Caddyfile`:
```caddyfile
log {
  output file /var/log/caddy/access.log {
    roll_size 10mb
    roll_keep 3
  }
}
```

---

## 3. Pembatasan Laju Akses Publik (Public Rate Limiting)

Dua lapisan rate limit aktif melindungi layanan dari brute-force dan DoS:

### Lapisan 1: Nginx Host (ai.ojixx.my.id)
Tambahkan konfigurasi berikut pada blok `http` dan `server` Nginx host:
```nginx
# Di /etc/nginx/nginx.conf (blok http):
limit_req_zone $binary_remote_addr zone=api_general_limit:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=api_auth_limit:10m rate=5r/m;

# Di /etc/nginx/sites-available/ai.ojixx.my.id (blok server 443):
location / {
    limit_req zone=api_general_limit burst=50 nodelay;
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

location /v1/auth/ {
    limit_req zone=api_auth_limit burst=10 nodelay;
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Lapisan 2: Fastify Application Rate Limit
Ditegakkan di `apps/api/src/app.ts`:
- **Global**: 100 request / menit per IP (`allowList: ['127.0.0.1']`).
- **Autentikasi (`/v1/auth/register`, `/v1/auth/login`)**: 10 request / menit per IP.

---

## 4. Header Keamanan (Security Headers)

Diterapkan serentak di level Caddy (`infrastructure/caddy/Caddyfile`) dan Fastify API (`apps/api/src/app.ts`):

1. **`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`**
   - Memaksa seluruh komunikasi browser hanya menggunakan HTTPS selama 1 tahun.
2. **`X-Content-Type-Options: nosniff`**
   - Mencegah browser melakukan MIME-sniffing terhadap berkas statis atau respons API.
3. **`X-Frame-Options: DENY`**
   - Melindungi aplikasi dari serangan clickjacking dengan melarang rendering di dalam `<iframe>`.
4. **`Referrer-Policy: strict-origin-when-cross-origin`**
   - Membatasi kebocoran path referer URL saat mengarah ke origin luar.
5. **`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`**
   - Menonaktifkan akses sensor perangkat keras yang tidak dibutuhkan.
6. **Redaksi Header `Server`**:
   - Menghilangkan banner versi server web untuk meminimalisasi fingerprinting.
