# ADR 0022: Skema RuntimeStepEvent dan Streaming Langkah Agent Live (Windows & Android)

## Status
Diterima (Accepted) — 2026-10-17

## Konteks
Personal AI OS mendukung eksekusi tugas runtime eksternal (seperti `omp` dan `hermes`) melalui `runtime-bridge`. Pada implementasi sebelumnya (Sesi 12 dan Sesi 13), bridge telah mem-parse stdout JSONL dan memancarkan server-sent events (SSE), namun terdapat kesenjangan pada alur data ujung-ke-ujung menuju klien:
1. `ToolStepCard.tsx` di Windows UI telah dibuat tetapi tidak diimpor atau ditampilkan oleh komponen mana pun di `apps/windows/src`.
2. Tidak ada skema event terstandarisasi antara bridge, worker, backend, dan kedua klien (Windows & Android). Worker memancarkan event ad-hoc tanpa sequence number (`urutan`), tanpa status per-langkah yang terstruktur, dan event `error`/`done` tidak tertangani secara seragam.
3. Output runtime berasal dari eksekusi eksternal yang tidak tepercaya (untrusted): rentan memuat teks raksasa, diff tanpa batas, atau kode injeksi HTML/skrip bila ditampilkan langsung di klien.
4. Klien Android (`TaskDetailScreen.tsx`) belum memiliki batas tinggi (`maxHeight`) dan kontrol "Lihat semua" untuk tampilan diff, serta belum menjamin pengurutan stabil saat terjadi rekoneksi dan replay event.

## Penelusuran Alur Data Ujung-ke-Ujung (Audit Lompatan)

Berdasarkan pemeriksaan kode nyata di repositori:
1. **Bridge (`apps/runtime-bridge/src/index.ts`) [ADA]**:
   - `parseOmpLine(line)` (baris 219–291) mem-parse stdout JSONL dari `omp -p ... --mode json`. Mengekstrak tipe `text`, `tool_start`, `tool_end`, `file_edit`, dan `error`.
   - `execute` (baris 389–408) mencatat event ke `record.events` dan mendispatch ke pendengar SSE.
   - Endpoint `GET /v1/runs/:id/events` (baris 448–474) memancarkan event SSE.
2. **Adapter (`packages/agent-core/src/runtimes/remote-adapter.ts`) [SEBAGIAN]**:
   - Polling periodik `GET /v1/runs/:id` (baris 130–142) mengambil `record.events` dan memanggil `input.onEvent`.
   - Namun tipe yang dikirim masih `Record<string, unknown>` lepas tanpa sequence number `urutan`, `taskId`, dan identitas `runtime`.
3. **Task Executor (`apps/agent-worker/src/task-executor.ts`) [SEBAGIAN]**:
   - `executeRuntimeTrack` (baris 516–546) memetakan `tool_start`/`tool_end` ke `task.tool_call`, serta `file_edit` dan `text` ke `task.progress`.
   - Gap: tidak ada skema bersama `RuntimeStepEvent`, event `error` dan `done` tidak diproses di `onEvent`, ketiadaan sanitasi dan limit ukuran diff/teks, serta pemanggilan `void onEvent(evt)` tanpa antrean urutan sekuensial yang rentan race condition.
4. **Penyimpanan & WebSocket (`apps/api/src/db/task-repository.ts` & `apps/api/src/routes/events-ws.ts`) [ADA]**:
   - `createTaskEvent` menyimpan ke tabel `task_events`.
   - `getTaskEvents(userId, taskId, { afterEventId })` mendukung replay dari event terakhir.
   - `registerEventsWsRoute` (`/v1/events/ws`) melayani streaming WebSocket dan replay otomatis via query parameter `last_event_id`.
5. **Klien Windows (`apps/windows/src`) [SEBAGIAN / TIDAK ADA DI CHAT]**:
   - `ToolStepCard.tsx` belum diimpor di mana pun. `TaskCard.tsx` hanya merender dump event dasar. ChatView tidak menampilkan status langkah runtime.
6. **Klien Android (`apps/android/src/screens/TaskDetailScreen.tsx`) [SEBAGIAN]**:
   - Timeline merender event dasar, namun diff belum memiliki batas tinggi (`maxHeight`) dan tombol "Lihat semua", serta urutan belum distabilkan dari replay.

## Keputusan

1. **Definisi Skema Bersama `RuntimeStepEvent` di `@personal-ai-os/shared`**:
   Skema ditempatkan di `packages/shared/src/tasks/runtime-step-event.ts` (murni TypeScript tanpa dependensi native platform agar kompatibel dengan React Native, Windows Vite, dan Node.js):
   - Jenis (`type`): `'message' | 'tool_start' | 'tool_end' | 'file_edit' | 'error' | 'done'`
   - Status (`status`): `'running' | 'completed' | 'failed'`
   - Metadata inti: `id: string`, `taskId: string`, `runtime: 'omp' | 'hermes' | string`, `urutan: number`, `waktu: string` (ISO timestamp)
   - Payload terstruktur: `text?: string`, `toolName?: string`, `input?: unknown`, `output?: unknown`, `path?: string`, `diff?: string`, `error?: string`, `summary?: string`, `durationMs?: number`, `exitCode?: number`

2. **Sanitasi dan Pembatasan Ukuran Output Runtime (Untrusted Content)**:
   - Batas teks (`MAX_RUNTIME_TEXT_LENGTH`): 16.384 karakter (16 KB). Teks melebihi batas dipotong dengan catatan `... [dipotong karena melebihi batas ukuran]`.
   - Batas diff (`MAX_RUNTIME_DIFF_LENGTH`): 32.768 karakter (32 KB).
   - Sanitasi konten: menghapus tag skrip, iframe, event handler inline, serta menetralkan konten tidak tepercaya sebelum disimpan ke `task_events` dan dirender di klien.

3. **Penegakan Urutan Sekuensial Bebas Race Condition**:
   - Pada `TaskExecutor.executeRuntimeTrack`, pemrosesan `onEvent` dimasukkan ke dalam antrean promise sekuensial berurutan dengan counter `stepSeq` inkremental. Hal ini menjamin `urutan` terurut stabil tanpa tertukar akibat latency I/O database.

4. **Integrasi Windows UI**:
   - Menghubungkan `ToolStepCard` ke `TaskCard` (panel Aktivitas) dan `ChatMessages` (panel Percakapan).
   - Menampilkan status langkah dinamis, badge runtime (`omp`/`hermes`), diff viewer berwarna, timeline collapsible, dan tombol Stop pembatalan.
   - Gulir otomatis (auto-scroll) hanya aktif jika posisi scroll pengguna berada di dasar container (`isAtBottom`).

5. **Integrasi Android UI**:
   - Memperbarui `TaskDetailScreen` dengan timeline langkah terstruktur menggunakan komponen React Native murni (tanpa salinan CSS).
   - Diff ditampilkan dalam font monospace dengan batas tinggi (`maxHeight: 160`) dan tombol toggle "Lihat semua" / "Tutup diff".
   - Menstabilkan urutan event dengan fungsi `sortRuntimeEvents` berbasis `urutan` dan `createdAt`.

6. **Ketahanan Terhadap Putus Koneksi (Replay Resilience)**:
   - Baik `TaskEventsStream` (Windows) maupun `TaskEventsWebSocketClient` (Android) melacak `lastEventId`. Saat koneksi terputus dan tersambung kembali, query parameter `last_event_id` dikirim ke `/v1/events/ws` untuk memutar ulang event yang terlewat tanpa duplikasi.

## Konsekuensi
- Seluruh runtime events terstandardisasi dalam satu format seragam lintas platform.
- Output terminal atau tool yang berukuran masif tidak lagi membebani memori klien atau bandwidth WebSocket.
- Pengguna di Windows dan Android memperoleh visibilitas langsung (live steps) terhadap proses coding/eksekusi agen secara transparan dan aman.
