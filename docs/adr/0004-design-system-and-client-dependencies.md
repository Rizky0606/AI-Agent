# ADR 0004: Design System Bersama, Font Inter Lokal, dan Library Ikon Klien

Status: accepted  
Tanggal: 2026-10-15  

## Konteks

Sebelumnya, Windows Agent (`apps/windows`) dan Android Client (`apps/android`) memiliki definisi tema yang terpisah:
- Windows menggunakan `apps/windows/src/ui/Theme.css` dengan palet gelap navy/indigo/cyan, banyak inline style (>77 lokasi), tanpa mode terang, dan tanpa library ikon (bergantung pada emoji Unicode mentah seperti `🪟`, `📁`, `📄`).
- Android menggunakan objek tema terpisah di `apps/android/src/components/Theme.ts` tanpa dukungan mode terang dan dengan inline style (>310 lokasi).
- Content Security Policy (CSP) Tauri (`default-src 'self'`) melarang pemuatan font eksternal dari CDN (seperti Google Fonts), sehingga aset tipografi harus dibundel secara lokal.

## Keputusan

1. **Sumber Token Tunggal di `@personal-ai-os/shared`**:
   - Dibuat modul `packages/shared/src/design/` yang menjadi *single source of truth* token desain terang dan gelap.
   - Token diekspor dalam TypeScript dan menyediakan:
     - `generateCssVariables()` untuk menghasilkan variabel CSS `:root` (dark/light) bagi aplikasi webview Windows.
     - `createAndroidTheme()` untuk menghasilkan objek tema yang kompatibel dengan React Native di Android.
   - Warna aksen disatukan menjadi satu aksen teal-mint (`#2DD4BF` pada dark, `#0D9488` pada light). Hierarki visual dibangun dari selisih kontras permukaan, bukan border tebal.

2. **Pembundelan Font Inter Lokal (WOFF2)**:
   - Font Inter (Regular 400, Medium 500, SemiBold 600, Bold 700) dibundel langsung dalam bentuk file WOFF2 lokal di `apps/windows/src/ui/assets/fonts/`.
   - Lisensi: **SIL Open Font License (OFL) 1.1**. Lisensi ini mengizinkan penggunaan, pembundelan, dan redistribusi font secara gratis bersama software.
   - Deklarasi `@font-face` di `Theme.css` merujuk ke path aset lokal, memastikan nol request jaringan ke CDN eksternal saat runtime.

3. **Penambahan Library Ikon Klien**:
   - **Windows Desktop (`apps/windows`)**: Ditambahkan `lucide-react`.
     - *Alasan*: Kompatibel dengan React 18, visual bersih dan modern, mendukung stroke adaptif dan pewarnaan via CSS variables.
     - *Alternatif yang ditolak*:
       - `@heroicons/react`: Pilihan ikon untuk konsep sistem/AI/tools terbatas.
       - Font Icon (FontAwesome): Memerlukan runtime webfont, rawan FOUT (Flash of Unstyled Text), dan sulit di-tree-shake.
       - Emoji Unicode: Render inkonsisten di berbagai versi OS, tidak dapat diwarnai secara adaptif dengan tema.
     - *Ukuran Bundel*: Tree-shaking Vite hanya menyertakan ikon yang diimpor (< 15 KB gzip pada bundle produksi).
     - *Lisensi*: ISC / MIT.
   - **Android Mobile (`apps/android`)**: Ditambahkan `lucide-react-native` dan `react-native-svg`.
     - *Alasan*: Memastikan paritas visual ikon dengan desktop Windows, render SVG resolusi tinggi tanpa distorsi piksel, dan pewarnaan dinamis via props warna token.
     - *Alternatif yang ditolak*:
       - `@expo/vector-icons`: Memuat file font raksasa (FontAwesome, Ionicons, MaterialIcons) yang tidak optimal untuk tree-shaking dan gaya visualnya tidak selaras dengan Lucide di desktop.
       - Aset bitmap PNG (@1x, @2x, @3x): Memperbesar ukuran APK dan tidak dapat berubah warna secara dinamis mengikuti token tema.
     - *Ukuran Bundel*: `react-native-svg` menambah binary native (~120 KB), `lucide-react-native` di-tree-shake per modul.
     - *Lisensi*: MIT.

4. **Komponen Modular Windows**:
   - Dibuat komponen dasar UI tanpa inline style di `apps/windows/src/ui/components/`: `Button`, `IconButton`, `Chip`, `Popover`, `Drawer`, `Dialog`, `Toast`, `EmptyState`, `Spinner`, `Skeleton`, dan `StatusDot`.
   - Dibuat komponen `MarkdownMessage` yang merender format GFM, blok kode dengan tombol salin, tautan terkonfirmasi aman via dialog, tanpa HTML mentah (sanitasi XSS ketat), dan teks pesan yang dapat diseleksi/disalin (`user-select: text`).

## Konsekuensi

- `@personal-ai-os/shared` kini mengekspor token desain dan generator tema untuk seluruh workspace.
- Klien Windows memiliki dukungan penuh untuk tema `dark`, `light`, dan `system` yang persisten di `localStorage`.
- Kedua klien memiliki konsistensi visual ikon Lucide dan tipografi Inter yang memenuhi rasio kontras WCAG AA (>= 4.5:1 untuk teks normal).
