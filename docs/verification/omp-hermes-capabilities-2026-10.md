# Verifikasi Kemampuan OMP dan Hermes — Oktober 2026

Dokumen ini disusun pada **Sesi 29** berdasarkan audit dokumentasi web resmi dan probe empiris read-only pada VPS Oracle Cloud ARM64 (*servernic*).
Sesuai aturan anti-halusinasi AGENTS.md, seluruh klaim memiliki bukti path:baris, kutipan dokumentasi resmi (disertai URL dan tanggal akses), atau keluaran perintah nyata yang diuji langsung.

---

## 1. Riset Dokumentasi Web Resmi (Akses: 18 Oktober 2026)

### 1.1 OMP (Oh-My-Pi)
- **Sumber Resmi**:
  - Website: [https://omp.sh](https://omp.sh) (diakses 18 Oktober 2026)
  - Repositori GitHub: [https://github.com/can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) (diakses 18 Oktober 2026)
  - Paket npm/bun: `@oh-my-pi/pi-coding-agent` (diakses 18 Oktober 2026)
- **Pengembang & Lisensi**:
  - Dikembangkan oleh Stencil Labs, Inc. (`https://stencil.so`).
  - Lisensi: **MIT** (`https://opensource.org/licenses/MIT`).
- **Hubungan dengan Pi (`pi.dev`)**:
  - Dikutip langsung dari README `can1357/oh-my-pi` (baris 30):
    > *"Built by Stencil Labs · Fork of Pi by @mariozechner"*  
    > *"Originally built on Mario Zechner's wonderful Pi (https://github.com/badlogic/pi-mono), omp adds everything you're missing."*
  - **Fakta Terverifikasi**: `omp` bukan implementasi baru dari nol, melainkan **fork dari Pi** ciptaan Mario Zechner (`badlogic/pi-mono`), yang kemudian ditambah engine Rust (~80k baris), 31 built-in tools, 14 LSP ops, 28 DAP ops, dan Bun worker.
  - Sedangkan `pi.dev` / `@earendil-works/pi-coding-agent` adalah paket Pi terpisah dengan protokol JSONL RPC.
- **Fitur Resmi yang Dideklarasikan**:
  1. **Subagents**: `task` fanning out ke worktrees terisolasi; komunikasi subagent via Agent Hub (`Alt+A`) untuk memantau transcript, steering message, revive, atau terminate.
  2. **Plan Mode / Code Review**: `/review` dengan prioritas P0-P3, `/annotate`, `ast_edit` dengan preview `(proposed)` card sebelum disk accept via `xd://resolve`.
  3. **Advisor Role**: `/advisor` memasang model kedua (reviewer) yang membaca setiap turn main agent dan menginjeksi review inline.
  4. **LSP & DAP In-Process**: 14 LSP ops (rename, willRenameFiles, diagnostics) dan DAP debugger (`lldb-dap`, `dlv`, `debugpy`).
  5. **Hashline Edits**: Edit berbasis content hash (`line#hash`) untuk mencegah whitespace collision dan menghemat token hingga 61%.
  6. **Time-Traveling Stream Rules (TTSR)**: Abort stream mid-token saat melanggar regex aturan, injeksi rule reminder, dan retry dari checkpoint yang sama.
  7. **Hindsight Memory / Mnemopi**: `retain`, `learn`, `recall` dengan memory scoped ke repositori.
  8. **Mode Eksekusi**: Flag `--mode text | json | rpc | rpc-ui`. Mode `json` memancarkan JSONL event stream.

### 1.2 Hermes Agent
- **Sumber Resmi**:
  - Website: [https://hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com) (diakses 18 Oktober 2026)
  - Repositori GitHub: [https://github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (diakses 18 Oktober 2026)
- **Pengembang & Lisensi**:
  - Dikembangkan oleh Nous Research (`https://nousresearch.com`).
  - Lisensi: **MIT** (`https://github.com/NousResearch/hermes-agent/blob/main/LICENSE`).
- **Fitur Resmi yang Dideklarasikan**:
  1. **Messaging Gateway**: Terhubung ke Telegram, Discord, Slack, WhatsApp, Signal, Email, dan CLI dalam satu proses gateway.
  2. **Closed Learning Loop & Memory**: Memori terkurasi dengan periodic nudges, autonomous skill creation setelah task kompleks, evaluasi dan perbaikan skill mandiri, serta pencarian FTS5 dengan Honcho user modeling.
  3. **Scheduled Automations**: Cron scheduler bahasa alami untuk tugas terjadwal mandiri tanpa kehadiran pengguna.
  4. **Subagents & Delegation**: `delegate_task` untuk subagent paralel, dan script Python yang memanggil tools via RPC.
  5. **Terminal Backends**: 7 backend lingkungan eksekusi (local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox).
  6. **CLI & Daemon**: Eksekusi CLI non-interaktif via `hermes -z <prompt>`. Daemon HTTP FastAPI di port 9119.

---

## 2. Hasil Aktual Probe VPS (Eksekusi 18 Oktober 2026)

### 2.1 OMP (Oh-My-Pi)
1. **Versi**:
   - Command: `/home/ubuntu/.local/bin/omp --version`
   - Output: `omp/18.6.1` / `omp v18.6.1`
2. **Help & Flag Utama**:
   - Output `omp --help` membuktikan:
     - Output modes: `--mode text (default) | json | rpc | rpc-ui`.
     - Non-interactive execution: `-p, --print`.
     - Plan & Architecture flags:
       - `--plan=<value>`: Plan model for architectural planning (or `PI_PLAN_MODEL` env).
       - `--goal=<value>`: Start fresh in goal mode (interactive only).
       - `--prewalk`: Switch from the active model to a fast/cheap model at the first edit/write after the plan's todo list exists.
       - `--plan-yolo`: Force read-only plan mode at start, auto-approve the plan on the model's first resolve call, then switch to `--plan-yolo-into` to implement it.
     - Subagent & Collaboration flags:
       - Tool `task`: *"Launch sub-agents for parallel tasks"*.
       - Subcommand `agents`: *"Manage bundled task agents (omp agents unpack)"*.
       - Subcommand `collab`: *"List active local Collab host metadata"*.
     - Tools bawaan terdaftar resmi:
       - `read`, `bash`, `edit`, `write`, `grep`, `glob`, `lsp`, `python`, `notebook`, `browser`, `computer`, `task`, `todo`, `web_search`, `ask`.
     - Subcommand `--help-all` tidak ada (`unknown flag: --help-all`). Subcommand mandiri dipanggil per nama (`omp <command>`).
3. **JSONL Event Stream Smoke Test**:
   - Command: `/home/ubuntu/.local/bin/omp -p "balas hanya: OK" --mode json --no-session`
   - Output nyata terverifikasi (JSONL berurutan):
     1. `session`: `{"type":"session","version":3,"id":"...","timestamp":"...","cwd":"/tmp"}`
     2. `agent_start`: `{"type":"agent_start"}`
     3. `turn_start`: `{"type":"turn_start"}`
     4. `message_start` (user): `role: "user", content: [{"type":"text","text":"balas hanya: OK"}]`
     5. `message_end` (user)
     6. `message_start` (assistant): `role: "assistant", api: "openai-completions", provider: "router9", model: "Gratisan"`
     7. `message_update`: `{"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":0}}`
     8. `message_update`: `{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"OK"}}`
     9. `message_update`: `{"type":"message_update","assistantMessageEvent":{"type":"text_end","contentIndex":0,"content":"OK"}}`
     10. `message_end` (assistant): `stopReason: "stop", usage: {input: 6570, output: 5, totalTokens: 6575}`
     11. `turn_end`: `{"type":"turn_end","message":{...},"toolResults":[]}`
     12. `agent_end`: `{"type":"agent_end","messages":[...],"isTerminal":true,"yielded":true}`

### 2.2 Hermes Agent
1. **Versi**:
   - Command: `/home/ubuntu/.local/bin/hermes --version`
   - Output: `Hermes Agent v0.20.5 (2026.8.19) · upstream 79b45d16 · local f93b3507 (+1 carried commit)`
   - Python: 3.11.15, OpenAI SDK: 2.24.0
2. **Help & Flag Utama**:
   - Command `hermes run` **TIDAK ADA** (`error: argument command: invalid choice: 'run'`).
   - Eksekusi non-interaktif terverifikasi via flag `-z, --oneshot PROMPT`:
     > *"-z PROMPT, --oneshot PROMPT: One-shot mode: send a single prompt and print ONLY the final response text to stdout. No banner, no spinner, no tool previews... Intended for scripts / pipes."*
   - Opsi pelaporan spend: `--usage-file PATH` (menulis laporan estimasi biaya dan token JSON bahkan saat gagal).
   - Opsi isolasi worktree: `--worktree, -w` (menjalankan agen di isolated git worktree).
   - Subcommand `chat`: memiliki opsi `-q QUERY` atau `--query-file PATH`, `-Q/--quiet`, `--run-budget SECONDS`, `--max-turns N`.
3. **CLI Prompt Test**:
   - Command: `/home/ubuntu/.local/bin/hermes -z "balas hanya: OK" --no-restore-cwd --safe-mode`
   - Output: Tepat string `OK` tanpa banner atau dekorasi.

### 2.3 Status Daemon Hermes (Port 9119 Loopback)
1. **Liveness**:
   - `curl -s http://127.0.0.1:9119/api/health`
   - Output: `{"ok":true,"version":"0.20.5","auth_required":false}` (TERVERIFIKASI).
2. **OpenAPI Routes**:
   - Menghasilkan rute pengelolaan file (`/api/files/*`), git review (`/api/git/review/*`), cron (`/api/cron/*`), kanban (`/api/plugins/kanban/*`), skills (`/api/skills/*`), sessions (`/api/sessions/*`), dan tools (`/api/tools/*`).
   - **TIDAK TERDAPAT** endpoint prompt execution interaktif via HTTP POST (hanya ada `/api/chat/image-upload`).
   - **Kesimpulan**: Daemon Hermes di port 9119 adalah dashboard dan manajemen sistem. Eksekusi prompt agen oleh backend kita tetap dilakukan melalui CLI non-interaktif `-z` atau ACP, bukan via HTTP loopback port 9119.

---

## 3. Matriks Keputusan Kandidat Fitur UI

| Kandidat Fitur | Terbukti Nyata? | Bukti Empiris | Cara Aktivasi | Risiko | Usaha | Keputusan Implementasi |
|---|---|---|---|---|---|---|
| **Tampilan Rencana (Plan Mode)** | **TERBUKTI** | Tool `todo` bawaan OMP, flag `--plan`, `--prewalk`, `--plan-yolo`, dan event `tool_start/tool_end` tool `todo` | Normalisasi event tool `todo`/`plan` ke `RuntimeStepType: 'plan'`. Render kartu Rencana khusus di UI Windows sebelum eksekusi aksi berisiko | Rendah | S | **DIIMPLEMENTASIKAN (Sesi 29)** |
| **Progres Sub-Agent di Timeline** | **TERBUKTI** | Tool `task` bawaan OMP (*"Launch sub-agents for parallel tasks"*), event `tool_start` dengan toolName `task` | Normalisasi event `tool_start` ber-toolName `task` ke badge subagent `isSubagent: true` atau type `subagent`. Timeline langkah menampilkan badge dan kartu delegasi paralel | Rendah | S | **DIIMPLEMENTASIKAN (Sesi 29)** |
| **Diagnostik LSP Evaluator Coding** | **TERBUKTI FITUR OMP, BELUM TERBUKTI VIA BRIDGE DOCKER** | Tool `lsp` ada di OMP, namun worker Docker terisolasi dari host workspace tanpa mount filesystem dua arah | Butuh bridge LSP interaktif dan language server terpasang per bahasa di host | Sedang/Tinggi | M/L | **CATAT SEBAGAI BACKLOG (ADR 0030)** (Evaluator tetap memakai `LocalCodingEnvironment` yang terbukti di container) |
| **Memori OMP / Hermes** | **TERBUKTI DI HOST, DITOLAK UNTUK UI KARENA RISIKO SPLIT-BRAIN** | OMP `~/.omp/agent/sessions/`, Hermes SQLite FTS5 | Penyimpanan sesi host | Tinggi (*split-brain* DB PostgreSQL & melanggar *zero silent storage*) | M | **TIDAK DIADOPSI** (Memori tetap berpusat di PostgreSQL via Drizzle Memory Sesi 10 & 28) |
| **Fitur Arahkan (Steer) Sesi 27** | **TERBUKTI TIDAK DIDUKUNG PADA ONE-SHOT BRIDGE** | `omp -p` dan `hermes -z` berjalan one-shot batch; child process bridge menutup stdin (`stdio: ['ignore', 'pipe', 'pipe']`) | Memerlukan runtime berprotokol interaktif dua arah (ACP/RPC stdin) | Sedang | M | **TIDAK DIAKTIFKAN PADA ONE-SHOT RUNTIME** (Label jujur di UI bahwa steering hanya aktif pada sesi interaktif dua arah) |
| **Runtime Ketiga: pi.dev** | **TIDAK TERPASANG DI VPS** | `which pi` kosong di host VPS | Paket `@earendil-works/pi-coding-agent`, lisensi MIT, mode RPC | Rendah | M | **DOKUMENTASIKAN DI ADR 0030** (Jangan dipasang sebelum izin pemilik) |
