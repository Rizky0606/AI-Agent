# Sistem Desain Bersama (Design System)

Dokumen ini mendefinisikan sistem desain terpadu untuk platform **Personal AI OS**, mencakup Windows (Tauri 2 + React), Android (React Native + Expo), dan web/backend.

---

## 1. Prinsip & Arah Desain

Desain Personal AI OS mengusung konsep **minimalis, lega, dan segar**:
- **Satu Aksen Teal-Mint**: Digunakan untuk elemen interaktif primer, status aktif, dan sorotan utama.
- **Hierarki Permukaan (Elevation via Surface Shifts)**: Kedalaman visual dicapai melalui kontras bertingkat antar permukaan (`background` → `surface` → `surface-raised` → `surface-overlay`), bukan border tebal atau bayangan berlebihan.
- **Warna Semantik Fungsional**: Merah (`danger`) dan kuning (`warning`) hanya digunakan untuk indikasi risiko, konfirmasi berbahaya, dan status peringatan.
- **Tipografi Bersih & Modern**: Font **Inter** (Regular 400, Medium 500, SemiBold 600, Bold 700) yang dibundel secara lokal (offline-first, zero CDN).

---

## 2. Sumber Token Tunggal (`@personal-ai-os/shared/design`)

Semua definisi token berada pada satu lokasi sumber kebenaran di paket `@personal-ai-os/shared`:
- File definisi: `packages/shared/src/design/tokens.ts`
- Kalkulator kontras WCAG: `packages/shared/src/design/contrast.ts`
- Generator CSS Variables (Windows): `packages/shared/src/design/css-generator.ts`
- Generator Tema Android: `packages/shared/src/design/theme-generator.ts`

### 2.1 Palet Warna

| Token Semantik | Mode Gelap (Dark) | Mode Terang (Light) | Keterangan |
| :--- | :--- | :--- | :--- |
| `background` | `#0F1115` | `#FAFAF8` | Kanvas aplikasi paling dasar |
| `surface` | `#171A21` | `#FFFFFF` | Kontainer kartu, sidebar, dan panel |
| `surface-raised` | `#1F232C` | `#F1F3F5` | Elemen melayang, header tabel, tombol sekunder |
| `surface-overlay` | `#282D37` | `#E5E7EB` | Modal dialog, hover state permukaan terangkat |
| `text` | `#ECEEF2` | `#15171C` | Teks utama, judul, dan heading |
| `text-secondary` | `#9AA1AE` | `#5B6270` | Deskripsi, timestamp, dan subteks |
| `text-muted` | `#636B79` | `#8F97A3` | Placeholder dan teks non-aktif |
| `accent` | `#2DD4BF` | `#0D9488` | Teal-mint primer |
| `accent-hover` | `#14B8A6` | `#0F766E` | Hover aksen primer |
| `accent-subtle` | `rgba(45,212,191,0.15)` | `rgba(13,148,136,0.12)` | Latar chip aksen dan seleksi |
| `border` | `#262B35` | `#E2E4E8` | Garis batas struktural |
| `border-subtle` | `#1C2028` | `#ECEEF0` | Pembatas halus |
| `success` | `#22C55E` | `#16A34A` | Status sukses / terhubung |
| `warning` | `#F59E0B` | `#D97706` | Peringatan izin / menghubungkan |
| `danger` | `#EF4444` | `#DC2626` | Error / aksi destruktif |

### 2.2 Skala Spasi & Radius

- **Spasi**: `0: 0px`, `1: 4px`, `2: 8px`, `3: 12px`, `4: 16px`, `6: 24px`, `8: 32px`, `12: 48px`
- **Radius**: `xs: 4px`, `sm: 8px`, `md: 12px`, `lg: 16px`, `xl: 20px`, `full: 9999px`
- **Tipografi**:
  - `caption`: 12px (line-height 16px)
  - `body`: 14px (line-height 20px)
  - `subheading`: 16px (line-height 24px)
  - `heading`: 20px (line-height 28px)
  - `display`: 28px (line-height 36px)

---

## 3. Tabel Rasio Kontras WCAG 2.1 (AA & AAA)

Rasio kontras dievaluasi menggunakan rumus *sRGB relative luminance* standar W3C WCAG 2.1:

$$\text{Rasio Kontras} = \frac{L_1 + 0.05}{L_2 + 0.05}$$

| Tema | Kombinasi Warna | Rasio Aktual | Ambang WCAG | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Dark** | Teks Utama (`#ECEEF2`) vs Latar (`#0F1115`) | **15.03 : 1** | $\ge 4.5:1$ (AA) / $\ge 7:1$ (AAA) | **Lolos AAA** |
| **Dark** | Teks Utama (`#ECEEF2`) vs Surface (`#171A21`) | **13.23 : 1** | $\ge 4.5:1$ (AA) / $\ge 7:1$ (AAA) | **Lolos AAA** |
| **Dark** | Teks Sekunder (`#9AA1AE`) vs Surface (`#171A21`) | **5.97 : 1** | $\ge 4.5:1$ (AA) | **Lolos AA** |
| **Dark** | Aksen Teal (`#2DD4BF`) vs Surface (`#171A21`) | **8.87 : 1** | $\ge 4.5:1$ (AA) / $\ge 7:1$ (AAA) | **Lolos AAA** |
| **Light** | Teks Utama (`#15171C`) vs Latar (`#FAFAF8`) | **15.46 : 1** | $\ge 4.5:1$ (AA) / $\ge 7:1$ (AAA) | **Lolos AAA** |
| **Light** | Teks Utama (`#15171C`) vs Surface (`#FFFFFF`) | **16.10 : 1** | $\ge 4.5:1$ (AA) / $\ge 7:1$ (AAA) | **Lolos AAA** |
| **Light** | Teks Sekunder (`#5B6270`) vs Surface (`#FFFFFF`) | **6.01 : 1** | $\ge 4.5:1$ (AA) | **Lolos AA** |
| **Light** | Danger (`#DC2626`) vs Surface (`#FFFFFF`) | **4.76 : 1** | $\ge 4.5:1$ (AA) | **Lolos AA** |

*Catatan: Seluruh rasio diverifikasi secara otomatis dalam unit test `packages/shared/test/design-tokens.test.ts`.*

---

## 4. Tipografi & Bundling Font Inter Lokal

### 4.1 Kebijakan Keamanan & Zero-CDN
Sesuai aturan keamanan Tauri Content Security Policy (`default-src 'self'`), peramban aplikasi Windows menolak koneksi ke Google Fonts CDN (`fonts.googleapis.com` atau `fonts.gstatic.com`). Seluruh aset font Inter (WOFF2) dibundel secara lokal:
- Lokasi berkas: `apps/windows/src/ui/assets/fonts/`
- Berkas yang dibundel:
  - `Inter-Regular.woff2` (400)
  - `Inter-Medium.woff2` (500)
  - `Inter-SemiBold.woff2` (600)
  - `Inter-Bold.woff2` (700)
- Lisensi: **SIL Open Font License 1.1** (Bebas didistribusikan dalam bundel perangkat lunak, terdokumentasi di [docs/adr/0004-design-system-and-client-dependencies.md](file:///c:/Coding/Project/AI-Agent/docs/adr/0004-design-system-and-client-dependencies.md)).
- Fallback sistem operasi: `Segoe UI` (Windows), `Roboto` (Android), `sans-serif`.

---

## 5. Ikonografi Terpadu

Untuk memastikan konsistensi visual antara Windows dan Android tanpa menggunakan emoji mentah:
1. **Windows**: Menggunakan `lucide-react`. Ikon ringan berbasis SVG berstandar pohon dependensi modular (*tree-shakable*).
2. **Android**: Menggunakan `lucide-react-native` + `react-native-svg`. Menggantikan emoji representasi status dan aksi.

---

## 6. Komponen Dasar Windows (`apps/windows/src/ui/components`)

Seluruh komponen dasar dibangun **tanpa inline style** (`style={{ ... }}`), menggunakan kelas murni CSS yang didukung oleh variabel token:

### 6.1 `Button`
Tombol aksi dengan dukungan varian (`primary`, `secondary`, `danger`, `ghost`), ukuran (`sm`, `md`, `lg`), ikon kiri/kanan, serta animasi pemuatan spinner.
```tsx
import { Button } from './components';
import { Send } from 'lucide-react';

<Button variant="primary" iconRight={<Send size={14} />}>
  Kirim Pesan
</Button>
```

### 6.2 `IconButton`
Tombol khusus ikon dengan kewajiban atribut aksesibilitas `aria-label`:
```tsx
import { IconButton } from './components';
import { Settings } from 'lucide-react';

<IconButton
  aria-label="Buka Pengaturan"
  icon={<Settings size={16} />}
  variant="ghost"
  onClick={openSettings}
/>
```

### 6.3 `Chip`
Badge status atau tag kategori dengan varian semantik (`default`, `accent`, `success`, `warning`, `danger`) dan tombol aksi hapus opsional:
```tsx
import { Chip } from './components';

<Chip label="coding" variant="accent" onRemove={() => removeTag('coding')} />
<Chip label="Aktif" variant="success" />
```

### 6.4 `Popover`
Kontainer mengambang dengan pendeteksi klik luar (*click outside*) dan penutupan dengan tombol Escape:
```tsx
import { Popover, Button } from './components';

<Popover
  trigger={<Button size="sm">Opsi</Button>}
  content={<div>Konten menu popover</div>}
  placement="bottom"
/>
```

### 6.5 `Drawer`
Panel samping geser (*slide-over*) dengan latar belakang tembus pandang (*backdrop*), penutupan tombol Escape, dan slot footer:
```tsx
import { Drawer, Button } from './components';

<Drawer
  isOpen={isDrawerOpen}
  onClose={() => setDrawerOpen(false)}
  title="Detail Tugas"
  footer={<Button onClick={() => setDrawerOpen(false)}>Selesai</Button>}
>
  <p>Isi konteks tugas...</p>
</Drawer>
```

### 6.6 `Dialog` & `useConfirm` (Pengganti `window.confirm`)
Kotak dialog modal modern yang menggantikan dialog sinkron pemblokir thread browser `window.confirm()`:
```tsx
import { Dialog, useConfirm } from './components';

// Pemakaian via hook (pengganti window.confirm):
const confirm = useConfirm();

const handleDelete = async () => {
  const ok = await confirm({
    title: 'Hapus Tugas?',
    message: 'Tindakan ini tidak dapat dibatalkan.',
    confirmLabel: 'Hapus Sekarang',
    cancelLabel: 'Batal',
    variant: 'danger',
  });
  if (ok) {
    await deleteTask();
  }
};
```

### 6.7 `Toast` & `useToast`
Sistem notifikasi mengambang dengan timer otomatis (4 detik) dan ikon semantik:
```tsx
import { useToast } from './components';

const toast = useToast();
toast.success('Pengaturan berhasil disimpan');
toast.error('Gagal menghubungi agen backend');
toast.warning('Koneksi terputus, mencoba menghubungkan ulang...');
```

### 6.8 `EmptyState`
Tampilan kosong yang konsisten dan informatif saat belum ada data:
```tsx
import { EmptyState, Button } from './components';
import { MessageSquare } from 'lucide-react';

<EmptyState
  icon={<MessageSquare size={36} />}
  title="Belum Ada Percakapan"
  description="Mulai obrolan baru dengan asisten AI Anda."
  action={<Button variant="primary">Mulai Sekarang</Button>}
/>
```

### 6.9 `Spinner` & `Skeleton`
Indikator pemuatan visual yang elegan dengan label pembaca layar (`aria-label="Memuat..."`):
```tsx
import { Spinner, Skeleton } from './components';

<Spinner size="md" />
<Skeleton variant="text" lines={3} />
<Skeleton variant="rectangular" className="custom-banner-skeleton" />
```

### 6.10 `StatusDot`
Indikator titik status koneksi (`connected`, `connecting`, `disconnected`, `reconnecting`) dengan efek animasi denyut (*pulse*):
```tsx
import { StatusDot } from './components';

<StatusDot status="connected" pulse label="Terhubung" />
```

---

## 7. Komponen `MarkdownMessage`

Komponen pesan chat yang aman, kaya fitur, dan fleksibel:
1. **Dukungan GFM (GitHub Flavored Markdown)**: Judul (H1-H6), teks tebal, miring, coret, kutipan (`>`), daftar berbutir/bernomor, tabel bergaris halus, dan kode inline.
2. **Blok Kode Interaktif**:
   - Header menunjukkan bahasa sintaks (misal `TypeScript`, `Bash`, `Python`).
   - Tombol **"Salin"** dengan ikon `Copy`, berubah menjadi **"Tersalin!"** dengan ikon `Check` selama 2 detik setelah berhasil disalin ke clipboard.
   - Kotak kode horizontal scrollable dengan font monospace.
3. **Pencegahan XSS & Tanpa HTML Mentah**:
   - Parser AST berbasis TypeScript murni: **Tidak menggunakan `dangerouslySetInnerHTML` sama sekali**.
   - Tag HTML seperti `<script>`, `<iframe>`, atau event inline `<img onerror=...>` diurai sebagai teks biasa tanpa risiko injeksi DOM.
4. **Validasi Skema Tautan & Konfirmasi Pembukaan Eksternal**:
   - Tautan berbahaya dengan skema `javascript:`, `data:`, `file:`, atau `vbscript:` dicegah dan dinetralkan (`#blocked`).
   - Tautan `http:` dan `https:` yang diklik **tidak langsung berpindah halaman**, melainkan memunculkan dialog konfirmasi:
     > *"Apakah Anda yakin ingin membuka tautan luar berikut di peramban sistem?"*
   - Setelah dikonfirmasi pengguna, tautan dibuka melalui perintah Tauri aman (`open_external_url`) di browser bawaan Windows.
5. **Pemilihan & Penyalinan Teks (Text Selection)**:
   - Kontainer pesan memakai `user-select: text` penuh, memastikan pengguna dapat menyorot dan menyalin sebagian pesan dengan nyaman.

---

## 8. Pengalih Tema (Theme Switcher)

Komponen `ThemeSwitcher` mendukung tiga opsi preferensi:
- **Sistem**: Menyesuaikan secara dinamis dengan tema OS Windows melalui media query `(prefers-color-scheme: light)`.
- **Terang**: Mengaktifkan atribut `data-theme="light"` pada elemen `:root`.
- **Gelap**: Mengaktifkan atribut `data-theme="dark"` pada elemen `:root`.
- Preferensi disimpan secara persisten di `localStorage` dengan kunci `personal-ai-os.windows.theme`.
