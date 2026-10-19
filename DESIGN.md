---
version: alpha
name: Personal AI OS
description: Unified cross-platform design system for Personal AI OS (Windows Desktop and Android Mobile)
colors:
  bg: '#0F1115'
  surface: '#171A21'
  surface-raised: '#1F232C'
  surface-overlay: 'rgba(23, 26, 33, 0.85)'
  border: 'rgba(255, 255, 255, 0.08)'
  border-subtle: '#262B36'
  border-focus: '#2DD4BF'
  text-primary: '#ECEEF2'
  text-secondary: '#9AA1AE'
  text-muted: '#636B79'
  text-inverse: '#0F1115'
  accent: '#2DD4BF'
  accent-hover: '#14B8A6'
  accent-subtle: 'rgba(45, 212, 191, 0.12)'
  success: '#22C55E'
  warning: '#F59E0B'
  danger: '#EF4444'
  info: '#2DD4BF'
typography:
  sans:
    fontFamily: Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif
  mono:
    fontFamily: Cascadia Code, Fira Code, Consolas, Courier New, monospace
  caption:
    fontSize: 12px
    lineHeight: 16px
    fontWeight: 400
  body:
    fontSize: 14px
    lineHeight: 20px
    fontWeight: 400
  subheading:
    fontSize: 16px
    lineHeight: 24px
    fontWeight: 500
  heading:
    fontSize: 20px
    lineHeight: 28px
    fontWeight: 600
  display:
    fontSize: 28px
    lineHeight: 36px
    fontWeight: 700
rounded:
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  full: 9999px
spacing:
  space-1: 4px
  space-2: 8px
  space-3: 12px
  space-4: 16px
  space-6: 24px
  space-8: 32px
---

# Sistem Desain Personal AI OS

Dokumen ini merekam bahasa desain resmi yang mengatur Personal AI OS pada klien Windows (Tauri 2 + React) dan Android (React Native + Expo), yang bersumber dari kode implementasi aktif.

---

## Overview

Personal AI OS mengusung identitas visual **asisten pribadi modern, lega, tenang, dan aman**:
- Menggunakan palet utama berorientasi gelap (*dark-first*) dengan aksen tunggal **Teal-Mint** (`#2DD4BF` / `#0D9488`).
- Kedalaman visual dicapai melalui pergeseran permukaan bertingkat (*surface elevation shifts*), bukan garis batas berat atau bayangan tebal.
- Warna bahaya/peringatan dialokasikan secara fungsional untuk mesin perizinan (*Permission Engine*) dan tingkat risiko tindakan (LOW, MEDIUM, HIGH, CRITICAL).
- Menjalankan kebijakan *zero-CDN* dengan font **Inter** dibundel lokal untuk keamanan dan integritas luring.

---

## Colors

Palet warna dikelola secara terpusat pada file sumber [packages/shared/src/design/tokens.ts](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L84-L160) dan diekspor ke CSS variables melalui [packages/shared/src/design/css-generator.ts](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/css-generator.ts#L8-L44):

- **Kanvas Dasar (`bg`)**: Warna latar belakang terendah aplikasi (`#0F1115` gelap / `#FAFAF8` terang).
- **Permukaan Kontainer (`surface`)**: Latar kartu, panel obrolan, bilah navigasi (`#171A21` gelap / `#FFFFFF` terang).
- **Permukaan Terangkat (`surface-raised`)**: Header kolom, tombol sekunder, item hover (`#1F232C` gelap / `#F1F3F5` terang).
- **Lapisan Mengambang (`surface-overlay`)**: Modal dialog, popover, drawer backdrop (`rgba(23, 26, 33, 0.85)` gelap / `rgba(255, 255, 255, 0.90)` terang).
- **Aksen Utama (`accent`)**: Teal-mint primer untuk tombol hero, status terhubung, fokus input (`#2DD4BF` gelap / `#0D9488` terang).
- **Semantik Status**:
  - `success`: `#22C55E` (gelap) / `#16A34A` (terang) — [tokens.ts:104, 143](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L104)
  - `warning`: `#F59E0B` (gelap) / `#D97706` (terang) — [tokens.ts:106, 145](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L106)
  - `danger`: `#EF4444` (gelap) / `#DC2626` (terang) — [tokens.ts:108, 147](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L108)

---

## Themes

Aplikasi mendukung tiga mode tema: `dark`, `light`, dan `system` (tersimpan di `localStorage` Windows [Theme.css](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/Theme.css#L1-L30) dan `ui-store` Android [Theme.ts](file:///c:/Coding/Project/AI-Agent/apps/android/src/components/Theme.ts#L10-L19)).

| Token Semantik | Mode Gelap (Dark - Default) | Mode Terang (Light) | Sumber Bukti |
| :--- | :--- | :--- | :--- |
| `background` | `#0F1115` | `#FAFAF8` | [tokens.ts:85, 124](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L85) |
| `surface` | `#171A21` | `#FFFFFF` | [tokens.ts:86, 125](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L86) |
| `surfaceElevated` | `#1F232C` | `#F1F3F5` | [tokens.ts:87, 126](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L87) |
| `surfaceOverlay` | `rgba(23, 26, 33, 0.85)` | `rgba(255, 255, 255, 0.90)` | [tokens.ts:88, 127](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L88) |
| `border` | `rgba(255, 255, 255, 0.08)` | `rgba(0, 0, 0, 0.08)` | [tokens.ts:90, 129](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L90) |
| `borderSubtle` | `#262B36` | `#E2E5E9` | [tokens.ts:91, 130](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L91) |
| `borderFocus` | `#2DD4BF` | `#0D9488` | [tokens.ts:92, 131](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L92) |
| `textPrimary` | `#ECEEF2` | `#15171C` | [tokens.ts:94, 133](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L94) |
| `textSecondary` | `#9AA1AE` | `#5B6270` | [tokens.ts:95, 134](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L95) |
| `textMuted` | `#636B79` | `#8A92A0` | [tokens.ts:96, 135](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L96) |
| `accent` | `#2DD4BF` | `#0D9488` | [tokens.ts:99, 138](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L99) |
| `accentHover` | `#14B8A6` | `#0F766E` | [tokens.ts:100, 139](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L100) |
| `accentSubtle` | `rgba(45, 212, 191, 0.12)` | `rgba(13, 148, 136, 0.10)` | [tokens.ts:101, 140](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L101) |

*Verifikasi Kontras*: Seluruh kombinasi warna diverifikasi lolos standar WCAG 2.1 AA ($\ge 4.5:1$) dan AAA ($\ge 7:1$) di [packages/shared/test/design-tokens.test.ts](file:///c:/Coding/Project/AI-Agent/packages/shared/test/design-tokens.test.ts#L25-L45).

---

## Typography

Keluarga font dan hierarki ukuran dikonfigurasi pada [tokens.ts:182-192](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L182-L192):

- **Font Sans**: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`.
  - Berkas lokal: `apps/windows/src/ui/assets/fonts/Inter-*.woff2` (Regular 400, Medium 500, SemiBold 600, Bold 700).
- **Font Mono**: `'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace` (untuk blok kode, diff, dan ID teknis).
- **Skala Ukuran Teks**:
  - `caption`: 12px (line-height: 16px, weight: 400) — Subteks, timestamp, lencana kecil.
  - `body`: 14px (line-height: 20px, weight: 400) — Konten pesan, paragraf, deskripsi setting.
  - `subheading`: 16px (line-height: 24px, weight: 500) — Judul kartu tugas, judul pesan dialog, header bagian.
  - `heading`: 20px (line-height: 28px, weight: 600) — Judul drawer, judul panel aktivitas, judul layar.
  - `display`: 28px (line-height: 36px, weight: 700) — Judul hero login onboarding.

---

## Layout

Tata letak aplikasi terbukti melalui struktur berikut:

1. **Windows Desktop Layout ([apps/windows/src/ui/layout/Layout.css](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/layout/Layout.css))**:
   - Struktur 3 kolom: Sidebar Kiri (lebar 260px) + Konten Tengah (fleksibel) + Drawer Aktivitas Kanan (lebar 360px saat terbuka).
   - Ambang Responsif: Sidebar otomatis menciut (*auto-collapse*) bila viewport $< 900\text{px}$ ([Sidebar.tsx:32](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/layout/Sidebar.tsx#L32)).
   - Batas Lebar Obrolan: Area obrolan tengah dibatasi maksimal lebar $\approx 720\text{px}$ untuk kenyamanan membaca.
   - Composer Pill Mengambang: Posisi `sticky` di bawah obrolan dengan bantalan spasi `space-4` (16px).
2. **Android Mobile Layout ([apps/android/src/screens/](file:///c:/Coding/Project/AI-Agent/apps/android/src/screens/))**:
   - Struktur 3-Tab Bottom Navigation: Chat, Aktivitas (dengan lencana counter tugas/approval tertunda), dan Lainnya ([index.ts](file:///c:/Coding/Project/AI-Agent/apps/android/index.ts)).
   - Mematuhi `react-native-safe-area-context` pada notch kamera dan bilah navigasi perangkat.
   - Ukuran target sentuh interaktif mematuhi batas minimal $\ge 44-48\text{dp}$ ([tokens.ts:194](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L194)).

---

## Elevation & Depth

Kedalaman visual diimplementasikan secara terstruktur tanpa bayangan berlebihan:
- **Tingkat 0 (Kanvas)**: `var(--color-bg)` (`#0F1115`).
- **Tingkat 1 (Panel & Kartu)**: `var(--color-surface)` (`#171A21`) dengan border halus `1px solid var(--color-border)`.
- **Tingkat 2 (Item Hover & List Aktif)**: `var(--color-surface-raised)` (`#1F232C`).
- **Tingkat 3 (Overlay & Modal)**: `var(--color-surface-overlay)` dengan backdrop filter `backdrop-filter: blur(8px)`.
- **Fokus Ring Aksesibilitas**: `0 0 0 3px var(--color-accent-subtle)` ([css-generator.ts:60](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/css-generator.ts#L60)).

---

## Shapes

Radius sudut mengikuti skala terstandarisasi ([tokens.ts:175-181](file:///c:/Coding/Project/AI-Agent/packages/shared/src/design/tokens.ts#L175-L181)):
- `sm` (8px): Lencana status kecil, tombol kontrol kecil, tag teknis, input teks inline.
- `md` (12px): Kartu tugas, kartu persetujuan, gelembung pesan chat, blok kode.
- `lg` (16px): Kontainer panel utama, modal dialog, kartu hero login.
- `xl` (20px): Floating composer pill.
- `full` (9999px): Avatar pengguna, pill status dot, tombol ikon bulat.

---

## Components

Komponen UI bersama di Windows dan padanannya di Android:

1. **Button ([apps/windows/src/ui/components/Button.tsx](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/components/Button.tsx))**:
   - Varian: `primary` (latar teal, teks gelap), `secondary` (permukaan terangkat), `danger` (latar merah), `ghost` (transparan).
   - Ukuran: `sm`, `md`, `lg`. Mendukung `iconLeft`, `iconRight`, dan `loading` spinner.
2. **IconButton ([apps/windows/src/ui/components/IconButton.tsx](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/components/IconButton.tsx))**:
   - Tombol ikon dengan kewajiban atribut `aria-label` untuk pembaca layar.
3. **Chip ([apps/windows/src/ui/components/Chip.tsx](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/components/Chip.tsx))**:
   - Tag kategori atau badge interaktif untuk Mode obrolan, Model catalog, dan Runtime picker (`Auto`, `omp`, `Hermes`).
4. **ToolStepCard ([apps/windows/src/ui/chat/ToolStepCard.tsx](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/chat/ToolStepCard.tsx)) & DiffBlock ([apps/android/src/screens/TaskDetailScreen.tsx](file:///c:/Coding/Project/AI-Agent/apps/android/src/screens/TaskDetailScreen.tsx#L33-L55))**:
   - Kartu eksekusi langkah agen yang dapat dilipat/dibuka.
   - Menampilkan status (berjalan, selesai, gagal), runtime badge, durasi, tombol Stop, dan baris diff kode dengan pewarnaan semantik (+ hijau, - merah).
5. **Dialog ([apps/windows/src/ui/components/Dialog.tsx](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/components/Dialog.tsx)) & useConfirm**:
   - Modal konfirmasi menggantikan `window.confirm`. Wajib untuk tindakan berisiko HIGH/CRITICAL.
6. **Toast ([apps/windows/src/ui/components/Toast.tsx](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/components/Toast.tsx))**:
   - Notifikasi mengambang dengan durasi auto-dismiss 4 detik.
7. **MarkdownMessage ([apps/windows/src/ui/chat/MarkdownMessage.tsx](file:///c:/Coding/Project/AI-Agent/apps/windows/src/ui/chat/MarkdownMessage.tsx)) & MarkdownView ([apps/android/src/components/MarkdownView.tsx](file:///c:/Coding/Project/AI-Agent/apps/android/src/components/MarkdownView.tsx))**:
   - Parser AST murni tanpa `dangerouslySetInnerHTML`.
   - Blok kode dengan penanda bahasa sintaks dan tombol Salin interaktif.
   - Validasi skema tautan luar yang aman (`#blocked` untuk skema berbahaya).

---

## Do's and Don'ts

### Do's
- **Gunakan Variabel Token**: Selalu gunakan `var(--color-*)` di CSS atau token `theme.colors` di React Native; jangan gunakan warna heksadesimal mentah di komponen.
- **Konsistensi Bahasa Indonesia**: Gunakan salinan teks antarmuka dalam bahasa Indonesia baku yang lugas (misal: "Setujui", "Tolak", "Hentikan", "Obrolan Baru").
- **Konfirmasi Bertingkat**: Selalu hadirkan modal konfirmasi `Dialog` untuk tindakan berisiko HIGH atau CRITICAL (misal: eksekusi perintah shell, penghapusan data).
- **Auto-Scroll Bersyarat**: Terapkan deteksi posisi pengguna (`isAtBottom`) sebelum menggulir otomatis agar tidak mengganggu pengguna yang sedang membaca riwayat di atas.

### Don'ts
- **Jangan Menggunakan Inline Styles**: Dilarang menuliskan `style={{ ... }}` pada komponen Windows webview; gunakan kelas CSS bertoken.
- **Jangan Memuat Aset dari CDN**: Dilarang mengimpor font, ikon, atau skrip dari URL eksternal (mematuhi CSP `'self'`).
- **Jangan Menggunakan `window.confirm` atau `window.alert`**: Selalu gunakan komponen `Dialog` modal atau `Toast`.
- **Jangan Mengeksekusi Tautan Mentah**: Tautan luar tidak boleh langsung dinavigasi di jendela aplikasi internal tanpa konfirmasi pengguna.
