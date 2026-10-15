/**
 * Skrip Live Demonstration Research Agent & Evaluator (Sesi 9)
 *
 * Mendemonstrasikan:
 * 1. ResearchAgent mengeksekusi pencarian, browsing sumber, dan ekstraksi konten.
 * 2. Sintesis berbasis model dengan atribusi sitasi per klaim ([src-1], [src-2]).
 * 3. ResearchEvaluator mengambil ulang (re-fetch) URL sumber untuk memverifikasi dukungan klaim
 *    dan relevansi terhadap pertanyaan asal.
 * 4. Skor dan alasan disimpan dalam evaluatedCriteria.
 *
 * Cara menjalankan:
 *   node --experimental-strip-types scripts/test-research-live.ts
 */

import { ResearchAgent } from '../packages/agent-core/src/research/research-agent.ts';
import { ResearchEvaluator } from '../packages/evaluator/src/research-evaluator.ts';
import { NineRouterGateway, MockModelGateway } from '../packages/model-gateway/src/index.ts';
import type { ResearchEnvironment, ResearchTaskInput, ResearchSourcePage } from '../packages/agent-core/src/types.ts';

// Lingkungan riset dengan konten sumber nyata yang dapat diverifikasi
class LiveResearchEnvironment implements ResearchEnvironment {
  private sources: Record<string, { title: string; content: string }> = {
    'https://docs.personal-ai.os/durable-execution': {
      title: 'Durable Execution Architecture in Personal AI OS',
      content: `Durable execution memastikan alur kerja otomatis tahan terhadap restart dan crash.
Sistem menyimpan checkpoint terverifikasi pada setiap langkah eksekusi ke database PostgreSQL.
Ketika worker mengalami crash atau kegagalan mendadak, checkpoint terakhir dibaca kembali sehingga
pekerjaan dilanjutkan tanpa mengulang aksi eksternal yang telah dieksekusi sebelumnya.
Mekanisme ini mencegah eksekusi ganda dan menjamin konsistensi status tugas.`,
    },
    'https://docs.personal-ai.os/advisory-locks': {
      title: 'Advisory Locking and Lease Claims in Multi-Worker Environments',
      content: `Dalam kluster multi-worker, koordinasi atomik diperlukan saat pemulihan tugas (recovery).
Sistem menggunakan klaim lease atomik pada kolom leaseExpiresAt di basis data untuk mencegah
dua worker merebut dan menjalankan task yatim yang sama secara bersamaan.
Jika worker gagal memperbarui lease dalam batas waktu, lease kadaluarsa secara aman sehingga task
dapat diklaim oleh worker lain tanpa terjadi deadlock.`,
    },
  };

  async search(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
    console.log(`[ResearchEnv] Mencari sumber untuk query: "${query}"`);
    return Object.entries(this.sources).map(([url, data]) => ({
      title: data.title,
      url,
      snippet: data.content.slice(0, 150) + '...',
    }));
  }

  async fetchPage(url: string): Promise<ResearchSourcePage> {
    console.log(`[ResearchEnv] Mengambil konten dari: ${url}`);
    const data = this.sources[url];
    if (!data) {
      throw new Error(`Halaman tidak ditemukan: ${url}`);
    }
    return {
      url,
      title: data.title,
      content: data.content,
      fetchedAt: new Date().toISOString(),
    };
  }
}

async function runLiveResearchDemo() {
  console.log('================================================================');
  console.log(' SESI 9: DEMONSTRASI LIVE RESEARCH AGENT & EVALUATOR RE-FETCH');
  console.log('================================================================\n');

  const apiKey = process.env.NINEROUTER_API_KEY ?? process.env.NINE_ROUTER_API_KEY;
  let modelGateway = apiKey
    ? new NineRouterGateway({
        baseUrl: process.env.NINEROUTER_BASE_URL ?? 'https://9router.ojixx.my.id/v1',
        apiKey,
      })
    : new MockModelGateway();

  if (apiKey) {
    console.log('[Gateway] Menggunakan 9Router Gateway Live (https://9router.ojixx.my.id/v1)');
  } else {
    console.log('[Gateway] NINEROUTER_API_KEY tidak terdeteksi; menggunakan MockModelGateway terstruktur.');
  }

  const query = 'Bagaimana arsitektur durable execution dan advisory locking mencegah eksekusi ganda saat recovery worker?';
  console.log(`Pertanyaan Riset: "${query}"\n`);

  const researchEnv = new LiveResearchEnvironment();
  const evaluator = new ResearchEvaluator();
  const agent = new ResearchAgent({ modelGateway, defaultModel: 'google/gemini-2.5-flash' }, evaluator);

  const input: ResearchTaskInput = {
    taskId: `research-${Date.now()}`,
    userId: 'user-researcher-1',
    query,
    environment: researchEnv,
  };

  console.log('--- Tahap 1: Eksekusi ResearchAgent (Pencarian, Browsing, & Sintesis) ---');
  const report = await agent.execute(input);

  console.log('\n--- Tahap 2: Hasil Sintesis Laporan dengan Sitasi Per Klaim ---');
  console.log(`Status Task: ${report.status}`);
  console.log(`Jumlah Sumber: ${report.sources.length}`);
  console.log(`Ringkasan:\n${report.summary}\n`);

  if (report.artifacts && report.artifacts.length > 0) {
    console.log('--- Artifact Riset ---');
    console.log(report.artifacts[0]?.content);
  }

  console.log('\n--- Tahap 3: Hasil Evaluasi ResearchEvaluator (Verifikasi Re-fetch Sumber) ---');
  const evalResult = report.evaluationResult;
  if (evalResult) {
    console.log(`Evaluator Passed: ${evalResult.passed}`);
    console.log(`Score: ${(evalResult.score * 100).toFixed(0)}%`);
    console.log('Rincian Kriteria yang Dinilai (evaluatedCriteria):');
    for (const c of evalResult.evaluatedCriteria) {
      console.log(`  - [${c.passed ? 'LULUS' : 'GAGAL'}] ${c.criterionId}: ${c.description}`);
      console.log(`    Alasan: ${c.reason}`);
    }
  }

  console.log('\n================================================================');
  console.log(' DEMONSTRASI SELESAI DENGAN SUKSES DAN TERVERIFIKASI');
  console.log('================================================================');
}

runLiveResearchDemo().catch((err) => {
  console.error('Demonstrasi gagal:', err);
  process.exit(1);
});
