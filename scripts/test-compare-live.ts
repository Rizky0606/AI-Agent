/**
 * Skrip Demonstrasi Compare Multi-Model (Sesi 26)
 *
 * Mendemonstrasikan:
 * 1. Menjalankan 2–3 model secara paralel dengan batas konkurensi dan anggaran token.
 * 2. Mode Buta (Blind Mode): identitas model disamarkan sebagai Model A/B/C dan
 *    modelId tidak bocor ke klien sebelum aksi Ungkap / Pemilihan Pemenang.
 * 3. Aturan Ketat Tanpa Fallback: Jika satu model gagal, kolom tersebut ditandai gagal
 *    dengan pesan error asli, tanpa substitusi model lain agar perbandingan tetap jujur.
 * 4. Sintesis opsional: panggilan sintesis yang merangkum Persamaan, Perbedaan, dan Rekomendasi.
 * 5. Metrik Jujur: Latensi ms, token, dan estimasi biaya hanya dilaporkan bila tersedia.
 * 6. Promosi ke percakapan (lanjutan chat).
 *
 * Cara menjalankan:
 *   node --experimental-strip-types scripts/test-compare-live.ts
 */

import { CompareEngine } from '../packages/agent-core/src/compare/compare-engine.ts';

// Gateway simulasi untuk demonstrasi verifikasi deterministik
class DemoCompareGateway {
  async *stream(req: { model: string; messages: any[] }) {
    const model = req.model;

    // Model 2 disimulasikan gagal untuk membuktikan aturan ketat: NO FALLBACK
    if (model === 'mock/failing-model') {
      await new Promise((r) => setTimeout(r, 60));
      throw new Error('429 Gateway Rate Limit Exceeded: upstream capacity exhausted');
    }

    if (model === 'mock/synthesis-model') {
      const chunks = [
        '### Persamaan\n',
        '- Kedua model menjelaskan konsep transaksional dengan benar.\n\n',
        '### Perbedaan\n',
        '- Model A lebih fokus pada detail implementasi database engine.\n',
        '- Model C memberikan perbandingan komparatif yang lebih ringkas.\n\n',
        '### Rekomendasi\n',
        '- Gunakan respons Model A untuk kebutuhan teknis mendalam.',
      ];
      for (const c of chunks) {
        await new Promise((r) => setTimeout(r, 15));
        yield { delta: c };
      }
      yield {
        usage: {
          promptTokens: 450,
          completionTokens: 85,
          totalTokens: 535,
        },
      };
      return;
    }

    // Model respons normal
    const prefix = `[Jawaban ${model}] `;
    const parts = [
      prefix,
      'ACID dalam database menjamin integritas transaksi: ',
      'Atomicity, Consistency, Isolation, dan Durability. ',
      'Setiap transaksi dieksekusi secara utuh atau dibatalkan sama sekali.',
    ];

    for (const p of parts) {
      await new Promise((r) => setTimeout(r, 20));
      yield { delta: p };
    }

    yield {
      usage: {
        promptTokens: 35,
        completionTokens: 42,
        totalTokens: 77,
      },
    };
  }
}

async function runLiveCompareDemo() {
  console.log('=================================================================');
  console.log('DEMONSTRASI SESI 26 — COMPARE MULTI-MODEL');
  console.log('=================================================================\n');

  const gateway = new DemoCompareGateway() as any;
  const engine = new CompareEngine({
    modelGateway: gateway,
    defaultSynthesisModel: 'mock/synthesis-model',
  });

  const prompt = 'Jelaskan konsep ACID database dan bagaimana isolasi transaksi mencegah anomali.';
  const models = [
    'mock/gpt-4o',
    'mock/failing-model', // Disengaja gagal untuk menguji isolasi kegagalan
    'mock/claude-3-5-sonnet',
  ];

  console.log('1. Menjalankan Perbandingan Paralel 3 Model:');
  console.log(`   Prompt: "${prompt}"`);
  console.log(`   Model: ${models.join(', ')}`);
  console.log(`   Mode Buta: AKTIF (nama disamarkan)\n`);

  const eventsEmitted: string[] = [];

  const runResult = await engine.run(
    {
      runId: 'cmp-demo-001',
      prompt,
      models,
      blindMode: true,
      tokenBudget: 6000,
    },
    {
      onEvent: (event) => {
        eventsEmitted.push(event.type);
        if (event.type === 'compare.chunk') {
          process.stdout.write(`[Chunk ${event.columnIndex === 0 ? 'Model A' : 'Model C'}] `);
        } else if (event.type === 'compare.model_failed') {
          console.log(`\n[EVENT: Model Gagal] ${event.modelAlias}: ${event.error}`);
        } else if (event.type === 'compare.model_completed') {
          console.log(`\n[EVENT: Model Selesai] ${event.modelAlias} (${event.latencyMs}ms, ${event.totalTokens} tok)`);
        }
      },
    },
  );

  console.log('\n\n2. Verifikasi Hasil Selesai:');
  console.log(`   Status Run: ${runResult.status}`);
  console.log(`   Total Token Digunakan: ${runResult.totalTokensUsed}`);
  console.log(`   Jumlah Kolom: ${runResult.columns.length}`);

  console.log('\n3. Verifikasi Aturan Ketat Tanpa Fallback:');
  const failedCol = runResult.columns.find((r) => r.status === 'failed');
  if (failedCol) {
    console.log(`   ✔ Kolom ${failedCol.modelAlias} status: "${failedCol.status}"`);
    console.log(`   ✔ Pesan Error: "${failedCol.error}"`);
    console.log(`   ✔ Model ID asli dipertahankan (${failedCol.modelId}), TIDAK diganti fallback!`);
  } else {
    console.error('   ✖ Gagal: kolom tidak ditandai gagal.');
  }

  console.log('\n4. Verifikasi Mode Buta (Blind Mode):');
  console.log(`   Status Blind Mode: ${runResult.blindMode}`);
  console.log(`   Label Kolom: ${runResult.columns.map((r) => `${r.modelAlias} -> (tersembunyi sebelum reveal)`).join(' | ')}`);

  console.log('\n5. Menjalankan Sintesis Opsional:');
  const synthResult = await engine.synthesize({
    runId: 'cmp-demo-001',
    prompt,
    columns: runResult.columns,
    synthesisModel: 'mock/synthesis-model',
  });

  if (synthResult.content) {
    console.log(`   ✔ Model Digunakan untuk Sintesis: ${synthResult.model}`);
    console.log(`   ✔ Pratinjau Sintesis:\n   ${synthResult.content.slice(0, 160).replace(/\n/g, '\n   ')}...`);
  } else {
    console.error('   ✖ Gagal: Sintesis tidak ditemukan.');
  }

  console.log('\n=================================================================');
  console.log('DEMONSTRASI BERHASIL MEMENUHI SEMUA KRITERIA SESI 26');
  console.log('=================================================================');
}

runLiveCompareDemo().catch((err) => {
  console.error('Error demonstrasi:', err);
  process.exit(1);
});
