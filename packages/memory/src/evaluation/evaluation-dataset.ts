import type { MemoryType } from '../types.ts';

export interface EvalMemoryItem {
  id: string;
  content: string;
  type: MemoryType;
  scope: string;
}

export interface MemoryEvalPair {
  id: string;
  query: string;
  expectedMemoryId: string;
  category:
    | 'lexical_exact'
    | 'semantic_paraphrase'
    | 'technical_decision'
    | 'user_preference'
    | 'cross_lingual';
  description: string;
}

/**
 * Curated corpus of 35 diverse memories representing realistic Personal AI OS context.
 */
export const EVAL_CORPUS: EvalMemoryItem[] = [
  {
    id: 'mem-01',
    content: 'Pengguna lebih memilih tema gelap (dark mode) dengan aksen warna teal mint dan font Inter.',
    type: 'preference',
    scope: 'global',
  },
  {
    id: 'mem-02',
    content: 'Tabel memories di PostgreSQL menggunakan ekstensi pgvector dengan kolom vector(1536) untuk cosine distance.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-03',
    content: 'Port default daemon Hermes adalah 9119 dan terhubung ke backend server lokal tanpa eksekusi prompt langsung.',
    type: 'knowledge',
    scope: 'project',
  },
  {
    id: 'mem-04',
    content: 'Langkah pemulihan kredensial akun pengguna dilakukan melalui tautan reset portal SSO autentikasi.',
    type: 'knowledge',
    scope: 'global',
  },
  {
    id: 'mem-05',
    content: 'Konfigurasi Caddy reverse proxy menggunakan file Caddyfile dengan TLS otomatis Let\'s Encrypt.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-06',
    content: 'Aturan keamanan arsitektur: tidak ada inferensi LLM lokal di server VPS ARM64 Oracle Cloud.',
    type: 'decision',
    scope: 'global',
  },
  {
    id: 'mem-07',
    content: 'Pengguna bekerja di zona waktu Asia/Jakarta (WIB) dengan jam produktif mulai pukul 08:00 hingga 17:00.',
    type: 'preference',
    scope: 'global',
  },
  {
    id: 'mem-08',
    content: 'Semua pemanggilan model AI harus melalui gateway backend 9Router di https://9router.ojixx.my.id/v1.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-09',
    content: 'Antrean background task menggunakan Redis BullMQ dengan mekanisme bounded retry maksimal 3 kali percobaan.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-10',
    content: 'Kunci privat ECDSA P-256 pada Windows disimpan secara aman menggunakan Windows DPAPI CryptProtectData.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-11',
    content: 'Pengguna menyukai ringkasan harian pekerjaan dikirim setiap pagi via notifikasi push FCM Android.',
    type: 'preference',
    scope: 'global',
  },
  {
    id: 'mem-12',
    content: 'Deep Research engine membatasi perayapan maksimal 2 halaman per domain untuk mencegah scraping berlebih.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-13',
    content: 'Model default untuk obrolan interaktif yang terverifikasi lulus tool calling adalah agentic/space-bunny-free.',
    type: 'knowledge',
    scope: 'global',
  },
  {
    id: 'mem-14',
    content: 'Protokol verifikasi tugas mengharuskan bukti nyata berupa hasil uji unit, kode keluar terminal, atau diff git.',
    type: 'decision',
    scope: 'global',
  },
  {
    id: 'mem-15',
    content: 'Tindakan berisiko HIGH dan CRITICAL wajib berhenti pada status waiting_approval untuk persetujuan pengguna.',
    type: 'decision',
    scope: 'global',
  },
  {
    id: 'mem-16',
    content: 'Pengguna menghindari penggunaan Tailwind CSS pada aplikasi web dan mewajibkan Vanilla CSS bermakna semantik.',
    type: 'preference',
    scope: 'project',
  },
  {
    id: 'mem-17',
    content: 'Cadangan data berkala offsite dienkripsi menggunakan algoritma AES-256-GCM terotentikasi sebelum diunggah ke S3.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-18',
    content: 'Pemeriksaan kepatuhan token desain antarmuka dilakukan dengan skrip check-design-tokens.ts untuk mencegah warna heksadesimal mentah.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-19',
    content: 'Pengguna memakai perangkat Windows 11 Pro 64-bit dan ponsel Google Pixel 8 dengan sistem operasi Android 15.',
    type: 'knowledge',
    scope: 'global',
  },
  {
    id: 'mem-20',
    content: 'Jadwal recurring task memiliki batas interval minimal 15 menit dan kuota maksimal 10 jadwal aktif per pengguna.',
    type: 'decision',
    scope: 'global',
  },
  {
    id: 'mem-21',
    content: 'Ekstraksi usulan skill baru mendeteksi alur berulang yang sukses dari task evaluator dan disimpan dalam status tidak aktif.',
    type: 'knowledge',
    scope: 'project',
  },
  {
    id: 'mem-22',
    content: 'Pustaka UI Android menggunakan React Native Animated API murni dengan useNativeDriver untuk menjaga kestabilan tanpa modul native reanimated.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-23',
    content: 'Filter data sensitif menyaring dan meredaksi kunci API sk-*, Bearer token, nomor NIK KTP, dan nomor kartu kredit.',
    type: 'decision',
    scope: 'global',
  },
  {
    id: 'mem-24',
    content: 'Pengguna lebih senang bahasa pengantar respons menggunakan Bahasa Indonesia formal, lugas, dan terstruktur rapi.',
    type: 'preference',
    scope: 'global',
  },
  {
    id: 'mem-25',
    content: 'Tauri 2 di Windows mengemas runtime WebView2 dan menyediakan integrasi baki sistem (system tray) native.',
    type: 'knowledge',
    scope: 'project',
  },
  {
    id: 'mem-26',
    content: 'Setiap berkas artefak yang diunggah divalidasi tanda tangan biner (magic bytes) untuk mendeteksi tipe MIME sebenarnya.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-27',
    content: 'Runtime OMP terbukti merupakan fork dari pi-mono buatan Mario Zechner dengan ekstensi native Rust.',
    type: 'knowledge',
    scope: 'project',
  },
  {
    id: 'mem-28',
    content: 'Pengguna memesan kopi hitam tanpa gula setiap rapat pagi jam 09:00.',
    type: 'preference',
    scope: 'global',
  },
  {
    id: 'mem-29',
    content: 'Pencarian semantik memori menggunakan cache berbasis ringkasan hash SHA-256 untuk menghindari penagihan ganda ke API embedding.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-30',
    content: 'Subcommand hermes run tidak tersedia di CLI Hermes v0.20.5; opsi non-interaktif resmi adalah hermes -z.',
    type: 'knowledge',
    scope: 'project',
  },
  {
    id: 'mem-31',
    content: 'Semua migration SQL dikelola secara idempoten dan diverifikasi kecocokan skemanya lewat schema-parity test.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-32',
    content: 'Metode penilaian evaluator riset mengecek keabsahan klaim dengan memverifikasi kutipan referensi URL ke web asli.',
    type: 'decision',
    scope: 'project',
  },
  {
    id: 'mem-33',
    content: 'Pengguna menyukai ringkasan kode dalam format unified diff daripada penulisan ulang seluruh isi berkas.',
    type: 'preference',
    scope: 'global',
  },
  {
    id: 'mem-34',
    content: 'Audit log mencatat setiap perubahan konfigurasi, persetujuan hak akses, dan penghapusan data dengan waktu presisi tinggi.',
    type: 'decision',
    scope: 'global',
  },
  {
    id: 'mem-35',
    content: 'Alur login Windows satu klik menggunakan protokol PKCE OAuth dengan validasi parameter state dan token akses aman.',
    type: 'decision',
    scope: 'project',
  },
];

/**
 * 35 test queries paired with the expected memory IDs.
 * Contains:
 * - 7 Lexical exact matches
 * - 10 Semantic paraphrases (different words, synonymous meaning)
 * - 7 Technical decisions
 * - 6 User preferences
 * - 5 Cross-lingual / hybrid queries
 */
export const EVAL_PAIRS: MemoryEvalPair[] = [
  // 1. Lexical exact matches
  {
    id: 'eval-01',
    query: 'Berapa port default daemon Hermes?',
    expectedMemoryId: 'mem-03',
    category: 'lexical_exact',
    description: 'Exact match query with keyword Hermes and port 9119',
  },
  {
    id: 'eval-02',
    query: 'Berapa dimensi kolom vector di tabel memories PostgreSQL?',
    expectedMemoryId: 'mem-02',
    category: 'lexical_exact',
    description: 'Exact match query with technical terms memories, pgvector, vector(1536)',
  },
  {
    id: 'eval-03',
    query: 'Bagaimana cara Caddy melakukan konfigurasi reverse proxy TLS otomatis?',
    expectedMemoryId: 'mem-05',
    category: 'lexical_exact',
    description: 'Exact keywords Caddy, Caddyfile, TLS otomatis',
  },
  {
    id: 'eval-04',
    query: 'Apa nama skrip untuk memeriksa kepatuhan token desain warna?',
    expectedMemoryId: 'mem-18',
    category: 'lexical_exact',
    description: 'Exact keyword check-design-tokens.ts',
  },
  {
    id: 'eval-05',
    query: 'Model default apa yang lulus verifikasi tool calling?',
    expectedMemoryId: 'mem-13',
    category: 'lexical_exact',
    description: 'Exact keywords model default, tool calling, space-bunny-free',
  },
  {
    id: 'eval-06',
    query: 'Berapa batas interval minimal recurring task dan kuota per user?',
    expectedMemoryId: 'mem-20',
    category: 'lexical_exact',
    description: 'Exact keywords interval minimal 15 menit, kuota 10 jadwal',
  },
  {
    id: 'eval-07',
    query: 'Apakah subcommand hermes run tersedia di CLI v0.20.5?',
    expectedMemoryId: 'mem-30',
    category: 'lexical_exact',
    description: 'Exact keywords hermes run, hermes -z',
  },

  // 2. Semantic paraphrases (Different wording / synonyms)
  {
    id: 'eval-08',
    query: 'Bagaimana cara pengguna mengganti atau memulihkan kata sandi akun?',
    expectedMemoryId: 'mem-04',
    category: 'semantic_paraphrase',
    description: 'Semantic query (ganti kata sandi) mapped to mem-04 (pemulihan kredensial SSO)',
  },
  {
    id: 'eval-09',
    query: 'Bagaimana tampilan visual antarmuka dan warna yang disukai user?',
    expectedMemoryId: 'mem-01',
    category: 'semantic_paraphrase',
    description: 'Semantic query (tampilan visual) mapped to mem-01 (tema gelap teal mint)',
  },
  {
    id: 'eval-10',
    query: 'Kapan jam kerja dan zona waktu aktivitas pengguna?',
    expectedMemoryId: 'mem-07',
    category: 'semantic_paraphrase',
    description: 'Semantic query (jam kerja) mapped to mem-07 (WIB 08:00 - 17:00)',
  },
  {
    id: 'eval-11',
    query: 'Bagaimana arsitektur melindungi server dari kelebihan beban komputasi AI?',
    expectedMemoryId: 'mem-06',
    category: 'semantic_paraphrase',
    description: 'Semantic query (kelebihan beban AI) mapped to mem-06 (tanpa inferensi lokal di VPS)',
  },
  {
    id: 'eval-12',
    query: 'Di mana semua permintaan model AI dialirkan agar terpusat?',
    expectedMemoryId: 'mem-08',
    category: 'semantic_paraphrase',
    description: 'Semantic query (permintaan model terpusat) mapped to mem-08 (gateway 9Router)',
  },
  {
    id: 'eval-13',
    query: 'Bagaimana proteksi kunci kriptografi lokal di sistem operasi Windows?',
    expectedMemoryId: 'mem-10',
    category: 'semantic_paraphrase',
    description: 'Semantic query (proteksi kunci kriptografi) mapped to mem-10 (DPAPI P-256)',
  },
  {
    id: 'eval-14',
    query: 'Berapa batasan perayapan web pencarian dalam satu website domain?',
    expectedMemoryId: 'mem-12',
    category: 'semantic_paraphrase',
    description: 'Semantic query (batasan perayapan web) mapped to mem-12 (Deep Research 2 halaman/domain)',
  },
  {
    id: 'eval-15',
    query: 'Bagaimana sistem memastikan tindakan berbahaya tidak berjalan otomatis tanpa izin?',
    expectedMemoryId: 'mem-15',
    category: 'semantic_paraphrase',
    description: 'Semantic query (tindakan berbahaya tanpa izin) mapped to mem-15 (HIGH/CRITICAL waiting_approval)',
  },
  {
    id: 'eval-16',
    query: 'Bagaimana pengamanan data rahasia seperti nomor KTP dan kartu pembayaran?',
    expectedMemoryId: 'mem-23',
    category: 'semantic_paraphrase',
    description: 'Semantic query (nomor KTP dan kartu pembayaran) mapped to mem-23 (SensitiveDataFilter NIK & kartu kredit)',
  },
  {
    id: 'eval-17',
    query: 'Bagaimana mekanisme pencegahan pemborosan kuota API saat membuat vektor?',
    expectedMemoryId: 'mem-29',
    category: 'semantic_paraphrase',
    description: 'Semantic query (pemborosan kuota API vektor) mapped to mem-29 (cache hash SHA-256)',
  },

  // 3. Technical decisions
  {
    id: 'eval-18',
    query: 'Bagaimana cara queue BullMQ menangani retry kegagalan job?',
    expectedMemoryId: 'mem-09',
    category: 'technical_decision',
    description: 'Technical query about BullMQ retry mechanics',
  },
  {
    id: 'eval-19',
    query: 'Mengapa framework CSS utilitas seperti Tailwind dilarang di proyek ini?',
    expectedMemoryId: 'mem-16',
    category: 'technical_decision',
    description: 'Technical query about CSS philosophy',
  },
  {
    id: 'eval-20',
    query: 'Metode enkripsi apa yang dipakai untuk mengamankan backup database di cloud?',
    expectedMemoryId: 'mem-17',
    category: 'technical_decision',
    description: 'Technical query about AES-256-GCM S3 backup encryption',
  },
  {
    id: 'eval-21',
    query: 'Mengapa modul reanimated tidak dipakai di aplikasi seluler Android?',
    expectedMemoryId: 'mem-22',
    category: 'technical_decision',
    description: 'Technical decision on React Native built-in Animated API',
  },
  {
    id: 'eval-22',
    query: 'Bagaimana verifikasi tipe berkas dilakukan saat pengguna mengunggah file?',
    expectedMemoryId: 'mem-26',
    category: 'technical_decision',
    description: 'Technical decision on magic bytes sniffing',
  },
  {
    id: 'eval-23',
    query: 'Dari mana kode sumber dan silsilah arsitektur runtime OMP berasal?',
    expectedMemoryId: 'mem-27',
    category: 'technical_decision',
    description: 'Technical knowledge about OMP fork of pi-mono',
  },
  {
    id: 'eval-24',
    query: 'Bagaimana cara menguji integritas perubahan skema tabel basis data?',
    expectedMemoryId: 'mem-31',
    category: 'technical_decision',
    description: 'Technical decision on schema-parity automated tests',
  },

  // 4. User preferences
  {
    id: 'eval-25',
    query: 'Kapan dan lewat saluran apa pengguna ingin menerima update ringkasan tugas?',
    expectedMemoryId: 'mem-11',
    category: 'user_preference',
    description: 'User preference query about daily morning push notifications',
  },
  {
    id: 'eval-26',
    query: 'Apa jenis ponsel pintar dan versi sistem operasi yang dipakai user?',
    expectedMemoryId: 'mem-19',
    category: 'user_preference',
    description: 'Hardware context: Pixel 8 with Android 15',
  },
  {
    id: 'eval-27',
    query: 'Bagaimana gaya bahasa yang diharapkan pengguna dalam komunikasi chat?',
    expectedMemoryId: 'mem-24',
    category: 'user_preference',
    description: 'Communication preference: Bahasa Indonesia formal dan lugas',
  },
  {
    id: 'eval-28',
    query: 'Minuman apa yang biasa disukai pengguna sebelum mulai meeting pagi?',
    expectedMemoryId: 'mem-28',
    category: 'user_preference',
    description: 'Personal habit: kopi hitam tanpa gula jam 09:00',
  },
  {
    id: 'eval-29',
    query: 'Bagaimana bentuk tampilan perubahan kode yang disukai pengguna saat refactoring?',
    expectedMemoryId: 'mem-33',
    category: 'user_preference',
    description: 'Coding preference: unified diff bukan rewrite utuh',
  },
  {
    id: 'eval-30',
    query: 'Di mana pengguna menyimpan private key untuk tanda tangan perangkat Windows?',
    expectedMemoryId: 'mem-10',
    category: 'user_preference',
    description: 'Security location: Windows DPAPI',
  },

  // 5. Cross-lingual / Hybrid queries
  {
    id: 'eval-31',
    query: 'How are database migrations verified against ghost columns and schema drift?',
    expectedMemoryId: 'mem-31',
    category: 'cross_lingual',
    description: 'English technical query mapped to Indonesian memory about schema parity',
  },
  {
    id: 'eval-32',
    query: 'What encryption cipher is utilized for offsite bucket archive storage?',
    expectedMemoryId: 'mem-17',
    category: 'cross_lingual',
    description: 'English technical query mapped to Indonesian memory about AES-256-GCM',
  },
  {
    id: 'eval-33',
    query: 'How does the desktop client implement zero-click single step login via OAuth?',
    expectedMemoryId: 'mem-35',
    category: 'cross_lingual',
    description: 'English technical query mapped to Indonesian memory about PKCE single step login',
  },
  {
    id: 'eval-34',
    query: 'What evidence does the evaluator check to prevent hallucinated completion?',
    expectedMemoryId: 'mem-14',
    category: 'cross_lingual',
    description: 'English evaluation query mapped to Indonesian memory about test exit codes and diffs',
  },
  {
    id: 'eval-35',
    query: 'How are newly discovered skills proposed from completed agent tasks?',
    expectedMemoryId: 'mem-21',
    category: 'cross_lingual',
    description: 'English skill query mapped to Indonesian memory about skill proposal extraction',
  },
];
