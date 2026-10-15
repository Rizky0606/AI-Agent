# ADR 0006: Redesain Layout Klien Windows, Modularisasi UI, dan Lokalisasi id-ID

- **Status**: Disetujui (Approved)
- **Tanggal**: 2026-10-15
- **Konteks**: Sesi 4 — Redesain Layout Windows

---

## 1. Konteks & Permasalahan

Sebelumnya, antarmuka klien Windows (`apps/windows/src/ui/App.tsx`) terkonsentrasi dalam satu berkas monolitik berukuran ~38 KB:
1. **Campuran Tanggung Jawab & Monolitik**: Komponen `ChatPanel`, `ProjectPanel`, `ServerTaskPanel`, `ApprovalPanel`, `ArtifactPanel`, serta tab `Security`, `Logs`, dan `Settings` berada di satu tempat dengan banyak inline style yang sulit dirawat.
2. **Keterbatasan UX Chat**: Teks pesan hanya berupa string mentah tanpa rendering Markdown berformat kaya, tidak ada aksi per pesan (salin, ulangi, edit), kartu tahapan eksekusi tool belum terstruktur, dan status kosong (*empty state*) tidak menyajikan prompt awal yang informatif.
3. **Penyalahgunaan Dialog Native**: Konfirmasi simpan file proyek dan penentuan keputusan persetujuan menggunakan `window.confirm` browser yang memblokir thread rendering dan tidak memberikan konteks risiko tindakan secara memadai.
4. **Bahasa Tidak Konsisten**: String antarmuka tercampur antara Bahasa Inggris dan Bahasa Indonesia yang tersebar di banyak komponen tanpa lokalisasi terpusat.
5. **Responsivitas & Aksesibilitas**: Header 7-tab horizontal mudah terpotong pada batas resolusi minimum 800x600, serta kurangnya penanganan fokus keyboard dan pintasan cepat.

---

## 2. Keputusan Arsitektur

### 2.1 Pemecahan Modul per Fitur
Berkas `App.tsx` dipecah menjadi modul independen berkohesi tinggi:
- **`src/ui/layout/`**: `Sidebar.tsx`, `AppHeader.tsx`, `ActivityDrawer.tsx`, dan `Layout.css`.
- **`src/ui/chat/`**: `ChatView.tsx`, `ChatMessages.tsx`, `ChatComposer.tsx`, `EmptyChatState.tsx`, `ToolStepCard.tsx`.
- **`src/ui/activity/`**: `ActivityPanel.tsx`, `ApprovalCard.tsx`, `TaskCard.tsx`, `ArtifactCard.tsx`.
- **`src/ui/project/`**: `ProjectView.tsx` (pohon file, editor kode, pratinjau diff, simpan aman).
- **`src/ui/settings/`**: `SettingsView.tsx` (Akun, Izin & Capability, Model, Tampilan, Integrasi Sistem, Lanjutan & Log).

### 2.2 Struktur Layout & Responsivitas (800x600)
- **Sidebar Kiri**:
  - Kolapsibel (bisa diciutkan secara manual atau otomatis di bawah lebar jendela 900 px).
  - Tombol aksi cepat *"Percakapan baru"* (didukung pintasan `Ctrl+N`).
  - Input pencarian percakapan (didukung pintasan `Ctrl+K`).
  - Daftar percakapan terkelompok secara kronologis: **Hari ini**, **Kemarin**, dan **Lebih lama**.
  - Pemilih proyek kerja (*Project selector*).
  - Footer dengan indikator status koneksi `StatusDot` dan profil pengguna.
- **Area Chat Terpusat (Maksimal 720 px)**:
  - Menggunakan komponen `MarkdownMessage` dari Sesi 2 dengan perlindungan tautan eksternal.
  - Aksi interaktif per pesan: Salin (*Copy* ke clipboard dengan toast umpan balik), Ulangi (*Retry*), dan Edit pesan pengguna.
  - Kartu tahapan tool (*ToolStepCard*) yang dapat dilipat (*collapsible*), dipersiapkan untuk data eksekusi nyata pada Sesi 12.
  - Status kosong (*Empty state*) menyajikan 4 kartu prompt inspirasi yang dapat diklik langsung.
- **Floating Pill Composer**:
  - Input melayang di bagian bawah dengan kontrol `Enter` untuk mengirim dan `Shift+Enter` untuk baris baru.
  - Tombol *Stop* saat asisten sedang streaming balasan.
  - Slot chip *Model* dan *Mode* disediakan untuk integrasi penuh di Sesi 6.
  - Tombol lampiran ditiadakan sementara hingga kapabilitas backend lampiran tersedia.
- **Drawer Aktivitas Kanan**:
  - Sub-tab terpadu: **Tugas**, **Persetujuan**, dan **Artefak**.
  - Badge notifikasi jumlah persetujuan pending pada header dan tombol drawer.
  - Kartu persetujuan menampilkan level risiko (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) dan konsekuensi secara eksplisit.
  - Tindakan pada risiko `HIGH` dan `CRITICAL` mewajibkan konfirmasi modal `Dialog` (menggantikan `window.confirm`).
- **Tampilan Proyek & Pengaturan Penuh**:
  - Tampilan Proyek menyediakan navigasi pohon berkas, editor teks dengan pratinjau diff, serta modal `Dialog` konfirmasi sebelum penyimpanan.
  - Pengaturan disajikan sebagai tampilan penuh (*full-page*) dengan navigasi sub-bagian yang tertata rapi.

### 2.3 Lokalisasi Terpusat (`id-ID.ts`)
Seluruh string antarmuka dipindahkan ke `apps/windows/src/ui/locales/id-ID.ts`. Tidak ada teks UI acak yang tertulis langsung (*hardcoded*) di dalam komponen. Seluruh terminologi mengacu pada Bahasa Indonesia baku yang konsisten.

### 2.4 Aksesibilitas
- Navigasi keyboard penuh dengan `:focus-visible` ring kontras tinggi.
- Tag semantik ARIA (`aria-label`, `aria-expanded`, `aria-live`, `role="region"`).
- Pintasan keyboard global: `Ctrl+N` untuk membuat percakapan baru, `Ctrl+K` untuk fokus pada pencarian percakapan.

---

## 3. Konsekuensi & Evaluasi

- **Kelebihan**:
  - Kode terstruktur bersih, mudah diuji secara modular, dan mematuhi batas ukuran file.
  - Zero inline styles: seluruh tampilan dikendalikan melalui token CSS design system.
  - Pengalaman pengguna jauh lebih modern, nyaman, dan aman dengan pencegahan aksi tidak sengaja via `Dialog`.
- **Keterbatasan yang Diketahui**:
  - Pengujian visual otomatis pada Windows memerlukan lingkungan fisik Windows atau Xvfb. Seluruh komponen diuji melalui unit test DOM dan sintaksis TypeScript strict.
