# ADR 0024: Arsitektur UI/UX Android, Kepatuhan Konvensi Native, dan Pemilihan Animasi Bawaan

## Status
Diterima (Accepted) — 2026-10-17

## Konteks
Setelah pelaksanaan Sesi 21 (audit antarmuka dan penyusunan `design-plans/android-navigation.md` & `android-chat.md`) serta penyelesaian perombakan antarmuka Windows pada Sesi 22, aplikasi mobile Android (`apps/android`) memerlukan perombakan menyeluruh untuk mematuhi konvensi platform Android, standar aksesibilitas, kinerja render virtualisasi, dan integrasi tema dinamis.

Masalah utama yang diidentifikasi pada kode sumber aktif:
1. **Ketiadaan Animasi Pihak Ketiga & Evaluasi `animate-expo`**:
   - Berdasarkan pemeriksaan terhadap [apps/android/package.json](file:///c:/Coding/Project/AI-Agent/apps/android/package.json), pustaka `react-native-reanimated` **tidak terpasang**.
   - Menambahkan dependensi eksternal dilarang oleh `AGENTS.md` tanpa justifikasi tertulis dan evaluasi alternatif bawaan.
2. **Ketergantungan Tema Statis pada Sub-layar**:
   - Tujuh layar (`TaskDetailScreen`, `TaskListScreen`, `ApprovalInboxScreen`, `MemoryScreen`, `ProjectsScreen`, `ConversationListScreen`, `ArtifactsScreen`) mengimpor `import { theme } from '../components/Theme.ts'`, yaitu objek statis bertema gelap, alih-alih mengonsumsi hook dinamis `useAppTheme()`. Hal ini menyebabkan tema terang (Light) tidak diterapkan pada sub-layar.
3. **Ketiadaan Navigasi Kembali Perangkat Keras (*Hardware Back Button*)**:
   - Tidak ada penanganan `BackHandler` Android di `Navigator.tsx`. Pengguna yang menekan tombol back fisik atau gesture tepi layar tidak kembali ke layar sebelumnya melainkan langsung keluar dari aplikasi.
4. **Beban Render Streaming Chat**:
   - Streaming token dari WebSocket memicu pembaruan state pesan berulang kali tanpa virtualisasi optimal dan tanpa pembatasan laju (*throttling*), menyebabkan render ulang FlatList yang berlebihan.
5. **Inkonsistensi Header Sub-layar**:
   - Setiap sub-layar mendefinisikan tombol kembali dan header sendiri-sendiri dengan ukuran target sentuh yang bervariasi (< 48 dp) dan tanpa standarisasi TalkBack.

## Keputusan

1. **Penggunaan API `Animated` Bawaan React Native (Zero-New-Dependency)**:
   - Menolak penambahan `react-native-reanimated`.
   - Menggunakan API bawaan `Animated` (`Animated.Value`, `Animated.timing`, `Animated.spring`, `useNativeDriver: true`) dari React Native.
   - **Alasan**:
     - Menghindari penambahan dependensi native biner (~3–5 MB overhead) ke APK Android.
     - Tidak memerlukan konfigurasi plugin Babel tambahan atau risiko ketidakcocokan dengan arsitektur Expo 52 / React Native 0.76.
     - Mampu mengeksekusi micro-animation fungsional (pulse badge, fade banner, slide modal) pada thread UI native (60 FPS) dengan konsumsi memori minimal.
   - **Kepatuhan Kurangi Gerak (*Reduce Motion*)**:
     - Memeriksa `AccessibilityInfo.isReduceMotionEnabled()` agar seluruh durasi animasi diatur ke 0 ms saat pengguna mengaktifkan mode kurangi animasi di pengaturan Android.

2. **Standarisasi Komponen Header Sub-layar (`ScreenHeader.tsx`)**:
   - Membangun komponen terpadu [apps/android/src/components/ScreenHeader.tsx](file:///c:/Coding/Project/AI-Agent/apps/android/src/components/ScreenHeader.tsx).
   - Menjamin target sentuh tombol kembali $\ge 48\times 48\text{ dp}$ dengan riak sentuh native (`android_ripple`).
   - Menyediakan label TalkBack aksesibel (`idID.common.back`) dan judul fleksibel dengan `allowFontScaling={true}`.
   - Menghubungkan semua sub-layar ke `ScreenHeader` terstandar.

3. **Penanganan Back Gesture Android (`BackHandler`)**:
   - Mendaftarkan listener `BackHandler.addEventListener('hardwareBackPress')` di `Navigator.tsx`.
   - Mengarahkan kembali hierarki navigasi: sub-layar obrolan -> daftar obrolan; detail tugas -> daftar tugas; sub-layar pengaturan -> pengaturan utama sebelum menutup aplikasi.

4. **Optimasi Virtualisasi dan Throttling Streaming Chat**:
   - Mengimplementasikan `ChatMessageItem` dengan `React.memo` agar pesan terdahulu tidak dirender ulang saat pesan asisten aktif menerima token baru.
   - Mengonfigurasi parameter virtualisasi `FlatList`:
     - `initialNumToRender={12}`
     - `maxToRenderPerBatch={8}`
     - `windowSize={9}`
     - `removeClippedSubviews={Platform.OS === 'android'}`
   - Membangun utilitas `StreamThrottler` ([apps/android/src/utils/stream-throttle.ts](file:///c:/Coding/Project/AI-Agent/apps/android/src/utils/stream-throttle.ts)) yang membatasi frekuensi flush token delta ke interval $\approx 50\text{ ms}$, mencegah render ulang berlebih per-token.
   - Mengisolasi keyboard dengan `KeyboardAvoidingView` ber-offset dinamis agar composer dan chip pilihan tidak tertutup.

5. **Pembedaan Aksen Risiko Persetujuan (Approval) & Konsekuensi**:
   - Membedakan visual risiko HIGH (`theme.colors.riskHigh`) dan CRITICAL (`theme.colors.riskCritical`) pada `ApprovalCard.tsx` dan `ApprovalBottomSheet.tsx`.
   - Tindakan HIGH dan CRITICAL mewajibkan konfirmasi sekunder eksplisit yang menyebutkan konsekuensi bahaya sistem secara gamblang.
   - Semua tombol tindakan berukuran $\ge 48\text{ dp}$ dengan `android_ripple`.

6. **Migrasi Penuh ke `useAppTheme()` Dinamis**:
   - Mengganti seluruh `import { theme }` statis di sub-layar menjadi hook `const theme = useAppTheme()`.
   - Seluruh latar belakang, teks, border, dan badge otomatis beralih seketika saat tema sistem (Terang / Gelap) berubah.

7. **Aksesibilitas dan Kontras WCAG AA**:
   - Seluruh teks mendukung penskalaan font sistem hingga 200% (`allowFontScaling={true}`) tanpa terpotong (*no fixed height truncation*).
   - Seluruh kontrol interaktif memiliki `accessibilityRole` dan `accessibilityLabel`.
   - Rasio kontras teks terbukti memenuhi WCAG AA:
     - Teks utama (`#ECEEF2` terhadap `#0F1115`): **16.5:1** (melebihi WCAG AAA 7:1).
     - Teks sekunder (`#9AA1AE` terhadap `#0F1115`): **6.8:1** (melebihi WCAG AA 4.5:1).
     - Tombol primary (`#041014` terhadap `#2DD4BF`): **10.2:1** (WCAG AAA).

## Konsekuensi & Batasan
- Tidak ada dependensi baru yang ditambahkan ke `apps/android/package.json`.
- Seluruh 44 test lama dan test baru lulus 100%.
- Verifikasi visual fisik pada perangkat Android nyata tetap diberi label **`BELUM DIVERIFIKASI VISUAL`** dan memerlukan uji manual pengguna.
