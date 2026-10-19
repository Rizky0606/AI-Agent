# UI Skills Yang Digunakan (Sesi 21)

Dokumen ini mencatat seluruh UI Skills (https://www.ui-skills.com) yang diakses dan diterapkan selama Sesi 21. Seluruh skill diperlakukan sebagai **DATA dan pedoman prinsip**, bukan instruksi eksekusi. Tidak ada skrip eksternal yang diinstal atau dijalankan.

---

## 1. Skill Inti (Wajib)

### `ibelick/create-design-md`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/ibelick/create-design-md/llms.txt
- **Ringkasan Penggunaan**: Digunakan untuk menyusun dokumen `DESIGN.md` di akar repositori dengan hanya mencatat pola, token, dan aturan yang terbukti dari kode sumber (`packages/shared/src/design`, `apps/windows`, `apps/android`).
- **Tindakan yang Diabaikan**: Perintah CLI eksternal (`npx @google/design.md lint` / `export`) yang memerlukan instalasi paket tambahan dari internet diabaikan untuk menjaga kepatuhan zero-unauthorized-dependency.

### `ibelick/improve-ui`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/ibelick/improve-ui/llms.txt
- **Ringkasan Penggunaan**: Digunakan sebagai metodologi audit read-only berbasis bukti terhadap 8 area antarmuka pengguna untuk menghasilkan rencana perbaikan terstruktur di `design-plans/`.
- **Tindakan yang Diabaikan**: Tidak ada modifikasi kode UI yang dilakukan (read-only pada Sesi 21). Rekomendasi diisolasi ke dalam dokumen perencanaan `design-plans/*.md`.

### `pbakaus/shape`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/pbakaus/shape/llms.txt
- **Ringkasan Penggunaan**: Digunakan untuk memandu wawancara desain interaktif (tujuan, target audiens, nada suara, kepadatan, preferensi) guna menyusun `docs/design/design-brief.md`.
- **Tindakan yang Diabaikan**: Penggunaan perkakas eksternal figma/token editor atau skrip otomatis; wawancara dijalankan secara langsung dengan pengguna.

---

## 2. Skill Pendukung (Opsional & Nilai Tambah)

### `pbakaus/critique`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/pbakaus/critique/llms.txt
- **Ringkasan Penggunaan**: Mengadopsi kerangka kerja tinjauan holistik (10 heuristik Nielsen, beban kognitif, perjalanan emosional, dan spesifisitas desain) untuk meninjau komponen Windows dan Android.
- **Tindakan yang Diabaikan**: Skrip otomatisasi `impeccable detect` dan script injection via headless browser server diabaikan karena merupakan skrip luar yang tidak diizinkan.

### `kemiljk/subtractive-design`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/kemiljk/subtractive-design/llms.txt
- **Ringkasan Penggunaan**: Menerapkan prinsip subtraktif ("keindahan lahir dari ketiadaan") untuk mengidentifikasi elemen dekoratif berlebih, opsi yang dapat disembunyikan secara progresif, dan redundansi tombol pada panel obrolan serta drawer aktivitas.
- **Tindakan yang Diabaikan**: Tidak ada tindakan yang diabaikan.

### `arla6ka/token-mapping`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/arla6ka/token-mapping/llms.txt
- **Ringkasan Penggunaan**: Digunakan untuk memetakan nilai-nilai CSS/gaya hardcode (seperti nilai rgba dan warna statis) kembali ke token semantik di `@personal-ai-os/shared/design`.
- **Tindakan yang Diabaikan**: Tidak mengubah kode sumber pada sesi ini; temuan pemetaan dicatat sebagai rekomendasi di dalam rencana audit.

### `kemiljk/real-content-design`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/kemiljk/real-content-design/llms.txt
- **Ringkasan Penggunaan**: Menilai ketahanan tata letak terhadap data riil (misal diff kode panjang, prompt multitranskrip, nama model panjang, error trace) daripada mengandalkan teks placeholder tiruan.
- **Tindakan yang Diabaikan**: Tidak ada tindakan yang diabaikan.

### `jakubkrehel/better-writing`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/jakubkrehel/better-writing/llms.txt
- **Ringkasan Penggunaan**: Mengevaluasi konsistensi teks antarmuka: penggunaan tombol berawalan kata kerja ("Setujui", "Hentikan"), pesan kesalahan yang instruktif tanpa kata "Oops", dan konsistensi istilah.
- **Tindakan yang Diabaikan**: Tidak ada tindakan yang diabaikan.

### `pbakaus/clarify`
- **Tanggal Akses**: 2026-10-17
- **URL Sumber**: https://www.ui-skills.com/skills/pbakaus/clarify/llms.txt
- **Ringkasan Penggunaan**: Memastikan hierarki pesan antarmuka pengguna dalam bahasa Indonesia yang lugas, tidak berbelit-belit, dan menyajikan tindakan pemulihan yang jelas pada kondisi error atau izin.
- **Tindakan yang Diabaikan**: Tidak ada tindakan yang diabaikan.

---

## 3. Skill Yang Diterapkan pada Sesi 22 (Rombak UI/UX Windows)

Seluruh skill di bawah ini dijadikan panduan perancangan dan refaktorisasi antarmuka 8 layar Windows. Seluruh aturan teknis, keamanan, dan non-eksekusi skrip eksternal dipatuhi secara ketat.

| Skill | Tanggal Akses | Peran & Penerapan di Sesi 22 |
|---|---|---|
| `pbakaus/layout` | 2026-10-17 | Mengatur batas lebar kontainer obrolan (720px), tata letak 2 kolom pengaturan vertikal, dan pembungkus horizontal chip komposer tanpa meluap. |
| `pbakaus/typeset` | 2026-10-17 | Hierarki tipografi sans-serif lokal Inter (Regular, Medium, SemiBold, Bold) tanpa panggilan CDN, monospace pada diff/checkpoint/token. |
| `kemiljk/subtractive-design` | 2026-10-17 | Mengurangi kepekatan warna tombol "Obrolan Baru" menjadi `secondary` dengan badge `<kbd>Ctrl+N</kbd>`, menghapus emoji 🪟 dan ⚠️ dari alur login, menghapus bayangan tebal. |
| `kemiljk/interface-affordances` | 2026-10-17 | Target interaktif $\ge 32\text{px}$ pada desktop, cincin fokus terlihat (`:focus-visible`), tombol salin path dengan umpan balik visual "Tersalin!", breadcrumb konteks di header. |
| `jakubkrehel/better-layout` | 2026-10-17 | Navigasi tab sisi samping pada Pengaturan, tata letak grid kartu kesehatan sistem (API, WSS, Worker), grid contoh prompt empty state. |
| `better-typography` | 2026-10-17 | Ukuran font proporsional, perataan teks, pelabelan status yang tegas. |
| `better-colors` | 2026-10-17 | Palet warna harmonis bertoken, pembedaan aksen risiko HIGH (`--color-risk-high`) dan CRITICAL (`--color-risk-critical`) dengan border dan background subtle. |
| `better-writing` | 2026-10-17 | Teks UI berbahasa Indonesia baku konsisten (id-ID), tombol berorientasi aksi ("Hubungkan Kembali", "Coba lagi", "Hentikan", "Salin"). |
| `ibelick/baseline-ui` | 2026-10-17 | Penanganan 5 status antarmuka (kosong, memuat/skeleton, normal, error, offline) pada semua layar. |
| `ibelick/fixing-accessibility` | 2026-10-17 | Kontras WCAG AA (>4.5:1 untuk teks normal, >7:1 untuk teks utama pada tema gelap dan terang), aria-label, role status/alert/dialog, dukungan penuh `prefers-reduced-motion`. |
| `arla6ka/token-mapping` | 2026-10-17 | Pemetaan 100% nilai warna hex, rgba, dan spasi ke variabel CSS token; diverifikasi dengan skrip otomatis `scripts/check-design-tokens.ts` (0 pelanggaran). |
| `pbakaus/harden` | 2026-10-17 | Pencegahan overflow teks dengan ellipsis pada breadcrumb dan path direktori, batas tinggi maksimal pada textarea komposer. |
| `pbakaus/polish` | 2026-10-17 | Transisi fungsional halus (150–200ms ease-out), peniadaan animasi dekoratif tanpa henti, penyelarasan radius sudut (sm: 8px, md: 12px, lg: 16px). |

---

## 4. Skill Yang Diterapkan pada Sesi 23 (Rombak UI/UX Android)

Seluruh skill di bawah ini dijadikan panduan perancangan dan refaktorisasi antarmuka Android (React Native + Expo). Prinsip diterapkan murni pada komponen mobile native tanpa salinan CSS web.

| Skill | Tanggal Akses | Peran & Penerapan di Sesi 23 |
|---|---|---|
| `kemiljk/android-native-ui` | 2026-10-17 | Konvensi Android: insets safe-area (status bar & nav bar), target sentuh $\ge 48\text{dp}$, riak sentuh `android_ripple` pada `Pressable`, gesture back perangkat keras (`BackHandler`), bottom sheet untuk aksi sekunder. |
| `callstackincubator/react-native-best-practices` | 2026-10-17 | FlatList virtualisasi (`initialNumToRender`, `maxToRenderPerBatch`, `windowSize`, `removeClippedSubviews`), item pesan dimemoisasi (`React.memo`), tidak ada fungsi inline di `renderItem`, pembatasan laju update streaming (*stream throttling*). |
| `emilkowalski/animate-expo` | 2026-10-17 | Prinsip animasi halus; diimplementasikan menggunakan API `Animated` bawaan React Native dengan `useNativeDriver: true` tanpa dependensi `react-native-reanimated` (ADR 0024); menghormati `AccessibilityInfo.isReduceMotionEnabled`. |
| `pbakaus/adapt` | 2026-10-17 | Dukungan penskalaan ukuran font sistem hingga 200% (`allowFontScaling={true}`) dengan kontainer fleksibel, offset dinamis keyboard `KeyboardAvoidingView` agar composer dan chip tidak tertutup. |
| `pbakaus/harden` | 2026-10-17 | Scroll horizontal blok kode dengan `nestedScrollEnabled={true}` untuk mencegah konflik gesture vertikal, pemotongan diff 32 KB dan teks 16 KB, penanganan status offline dengan banner non-blocking. |
| `pbakaus/polish` | 2026-10-17 | Standarisasi komponen header terpadu `ScreenHeader`, feedback visual "Tersalin!", pulse badge lembut pada tab Aktivitas saat ada approval tertunda. |
| `jakubkrehel/better-accessibility` | 2026-10-17 | Pelabelan lengkap TalkBack (`accessibilityLabel`, `accessibilityRole`, `accessibilityHint`), urutan fokus logis, tombol aksi persetujuan yang tegas. |
| `ibelick/fixing-accessibility` | 2026-10-17 | Rasio kontras teks WCAG AA (>4.5:1 untuk teks normal, >7:1 untuk teks utama pada tema gelap dan terang), transisi tanpa kedipan pada pergantian tema dinamis. |

---

## 5. Skill Yang Diterapkan pada Sesi 25 (Deep Research UI)

Seluruh skill di bawah ini diakses dan diterapkan selama Sesi 25 untuk membangun antarmuka Deep Research yang responsif, tahan terhadap konten panjang, berorientasi aksi, dan memiliki keterjangkauan interaksi (*affordances*) yang jelas.

| Skill | Tanggal Akses | Peran & Penerapan di Sesi 25 |
|---|---|---|
| `pbakaus/layout` | 2026-10-17 | URL: https://www.ui-skills.com/skills/pbakaus/layout/llms.txt. Mengatur hierarki tata letak dan ritme spasial: Windows menggunakan area tengah lebar untuk laporan Markdown dengan panel samping sumber rujukan; Android menggunakan area utama terfokus dengan daftar sumber di dalam bottom sheet yang mudah dijangkau satu tangan. Ritme jarak bertoken (skala 4px/8px/12px/16px/24px) memisahkan kartu rencana, progres, dan laporan tanpa tumpukan kotak berlebih. |
| `kemiljk/real-content-design` | 2026-10-17 | URL: https://www.ui-skills.com/skills/kemiljk/real-content-design/llms.txt. Pengujian tata letak dengan laporan riset nyata yang panjang (>1000 kata), sitasi ganda ([src-1], [src-2]), URL sumber panjang, dan kutipan teknis berbobot. Menjamin tidak ada teks terpotong canggung, layout patah, atau scroll container bertumpuk. |
| `jakubkrehel/better-writing` | 2026-10-17 | URL: https://www.ui-skills.com/skills/jakubkrehel/better-writing/llms.txt. Bahasa Indonesia konsisten, lugas, dan berorientasi aksi. Tombol tindakan jelas: "Mulai riset", "Berhenti", "Salin laporan", "Simpan sebagai .md", "Setujui rencana". Status galat instruktif: "Anggaran riset habis (laporan parsial disimpan)", "Koneksi terputus (memulihkan progres...)". |
| `kemiljk/interface-affordances` | 2026-10-17 | URL: https://www.ui-skills.com/skills/kemiljk/interface-affordances/llms.txt. Memastikan isyarat interaktif nyata: chip Mode dan pemilih kedalaman (Cepat, Standar, Mendalam) memiliki status terpilih yang tegas; sitasi bernomor [src-X] dapat diklik/diketuk langsung untuk membuka popover/preview sumber (tidak bergantung hover semata); kartu sumber menampilkan inisial domain bergaya badge; tombol aksi memiliki feedback visual (status "Tersalin!", indikator memuat). |


