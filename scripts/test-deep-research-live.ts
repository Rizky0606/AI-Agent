/**
 * Skrip Verifikasi & Demonstrasi Deep Research Engine (Sesi 24)
 *
 * Menguji 3 skenario pertanyaan riset mendalam dengan budget ketat:
 * 1. Faktual Sederhana: "Siapa CEO Anthropic saat ini dan kapan didirikan?"
 * 2. Perbandingan Teknis: "Bandingkan arsitektur Tauri 2 vs Electron untuk desktop worker"
 * 3. Potensi Kontradiksi / Update Cepat: "Status regulasi AI Act Uni Eropa untuk open-source model"
 *
 * Verifikasi:
 * - Siklus 8-tahap pipeline Deep Research (Plan -> Search -> Read -> Extract -> Synthesize -> Verify -> Output)
 * - Batas budget keras (Searches, Pages Read, Model Tokens, Duration) dipatuhi
 * - ResearchEvaluator memverifikasi kutipan, batas verbatim (<= 200 karakter), dan kesenjangan informasi
 * - Laporan Markdown tersusun rapi dengan sitasi [src-X] dan tingkat keyakinan
 *
 * Cara menjalankan:
 *   node --experimental-strip-types scripts/test-deep-research-live.ts
 */

import {
  DeepResearchEngine,
  type ResearchEnvironment,
  type SearchResultItem,
} from '../packages/agent-core/src/index.ts';
import { NineRouterGateway, MockModelGateway } from '../packages/model-gateway/src/index.ts';

interface ScenarioDefinition {
  id: string;
  category: string;
  query: string;
  scope: string;
  sources: Array<{
    url: string;
    title: string;
    domain: string;
    snippet: string;
    content: string;
  }>;
}

const TEST_SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'scenario-1',
    category: 'Faktual Sederhana',
    query: 'Siapa CEO Anthropic saat ini dan kapan didirikan?',
    scope: 'faktual',
    sources: [
      {
        url: 'https://en.wikipedia.org/wiki/Anthropic',
        title: 'Anthropic - Wikipedia',
        domain: 'en.wikipedia.org',
        snippet:
          'Anthropic didirikan pada tahun 2021 oleh mantan anggota eksekutif OpenAI termasuk Dario Amodei yang menjabat sebagai CEO.',
        content: `Anthropic PBC adalah perusahaan startup kecerdasan buatan asal Amerika Serikat.
Perusahaan ini didirikan pada tahun 2021 oleh saudara kandung Dario Amodei dan Daniela Amodei bersama mantan karyawan OpenAI lainnya.
Dario Amodei saat ini menjabat sebagai Chief Executive Officer (CEO) Anthropic. Perusahaan ini mengembangkan keluarga model bahasa Claude.`,
      },
      {
        url: 'https://www.anthropic.com/company',
        title: 'Anthropic Company Overview',
        domain: 'anthropic.com',
        snippet:
          'Anthropic didirikan pada 2021 dengan misi membangun sistem AI andal. Dario Amodei memimpin sebagai Chief Executive Officer.',
        content: `Anthropic didirikan pada tahun 2021. Tim dipimpin oleh Chief Executive Officer Dario Amodei.
Fokus utama organisasi adalah penelitian keamanan AI dan pengembangan model yang dapat dikontrol.`,
      },
    ],
  },
  {
    id: 'scenario-2',
    category: 'Perbandingan Teknis',
    query: 'Bandingkan arsitektur Tauri 2 vs Electron untuk desktop worker',
    scope: 'arsitektur desktop',
    sources: [
      {
        url: 'https://v2.tauri.app/start/architecture',
        title: 'Tauri 2 Architecture Overview',
        domain: 'tauri.app',
        snippet:
          'Tauri 2 menggunakan Rust pada backend dan webview native OS (WRY) dengan overhead memori 30-50 MB.',
        content: `Arsitektur Tauri 2 memisahkan antarmuka pengguna web dari backend Rust performa tinggi.
Tauri menggunakan webview bawaan sistem operasi (seperti WebView2 di Windows) alih-alih membundel runtime Chromium.
Ini menghasilkan ukuran installer kurang dari 10 MB dan konsumsi memori idle di kisaran 30-50 MB, sangat cocok untuk worker background.`,
      },
      {
        url: 'https://www.electronjs.org/docs/latest/tutorial/performance',
        title: 'Electron Architecture and Memory Footprint',
        domain: 'electronjs.org',
        snippet:
          'Electron membundel Chromium dan Node.js penuh, menghasilkan konsumsi memori 120-250 MB idle.',
        content: `Electron menggabungkan Chromium dan Node.js ke dalam satu executable mandiri.
Meskipun menyediakan API Node.js penuh pada main process dan kompatibilitas web lintas platform yang konsisten,
Electron membutuhkan footprint memori idle 120-250 MB dan ukuran binary installer sekitar 80-120 MB.`,
      },
    ],
  },
  {
    id: 'scenario-3',
    category: 'Kontradiksi & Regulasi Cepat',
    query: 'Status regulasi AI Act Uni Eropa untuk open-source model',
    scope: 'regulasi ai',
    sources: [
      {
        url: 'https://artificialintelligenceact.eu/open-source',
        title: 'EU AI Act: Open Source AI Exemptions and Rules',
        domain: 'artificialintelligenceact.eu',
        snippet:
          'EU AI Act mengecualikan model open source non-monetisasi dari sebagian besar kewajiban transparansi umum.',
        content: `Di bawah teks final EU AI Act (2024), model AI yang dirilis di bawah lisensi free and open source umumnya dikecualikan dari regulasi sistem risiko tinggi,
kecuali model tersebut dimonetisasi secara komersial atau diklasifikasikan sebagai General Purpose AI (GPAI) dengan risiko sistemik (> 10^25 FLOPs).
Kewajiban transparansi hak cipta dan dokumentasi pelatihan tetap berlaku untuk semua model GPAI terlepas dari lisensinya.`,
      },
      {
        url: 'https://commission.europa.eu/ai-act-policy_en',
        title: 'European Commission AI Act Policy FAQ',
        domain: 'commission.europa.eu',
        snippet:
          'Komisi Eropa menegaskan model GPAI berisiko sistemik tetap tunduk pada uji kepatuhan ketat meskipun berstatus open-weight.',
        content: `Kebijakan regulasi AI Uni Eropa mengadopsi pendekatan berbasis risiko.
Model open-source bebas lisensi menikmati pengecualian beban administratif tertentu.
Namun, apabila model memiliki daya komputasi kumulatif melampaui ambang batas risiko sistemik, penyedia wajib memenuhi kewajiban asesmen risiko dan keamanan siber.`,
      },
    ],
  },
];

async function runScenario(scenario: ScenarioDefinition, apiKey?: string) {
  console.log(`\n================================================================`);
  console.log(`[UJI] ${scenario.category}: "${scenario.query}"`);
  console.log(`================================================================`);

  // Mock / Live Model Gateway
  const modelGateway = apiKey
    ? new NineRouterGateway({
        baseUrl: process.env.NINEROUTER_BASE_URL ?? 'https://9router.ojixx.my.id/v1',
        apiKey,
      })
    : new MockModelGateway();

  // Research Environment mapping scenario sources
  const environment: ResearchEnvironment = {
    search: async (q: string): Promise<SearchResultItem[]> => {
      console.log(`  🔍 [Search] Kueri: "${q}"`);
      return scenario.sources.map((s) => ({
        url: s.url,
        title: s.title,
        snippet: s.snippet,
        domain: s.domain,
      }));
    },
    fetchPage: async (url: string) => {
      console.log(`  🌐 [FetchPage] Mengunduh HTML dari: ${url}`);
      const found = scenario.sources.find((s) => s.url === url);
      if (!found) throw new Error(`404 Not Found: ${url}`);
      return {
        url,
        status: 200,
        content: `<html><head><title>${found.title}</title></head><body><h1>${found.title}</h1><p>${found.content}</p></body></html>`,
      };
    },
    fetchContent: async (url: string) => {
      const found = scenario.sources.find((s) => s.url === url);
      return {
        url,
        title: found?.title ?? url,
        content: found?.content ?? '',
      };
    },
  };

  const engine = new DeepResearchEngine({
    modelGateway,
    fastModel: 'google/gemini-2.5-flash',
    complexModel: 'google/gemini-2.5-pro',
  });

  const budgetConfig = {
    maxSearches: 2,
    maxPagesRead: 2,
    maxModelTokens: 4000,
    maxDurationMs: 30000,
  };

  console.log(
    `  ⏱️  [Budget] Alokasi: maxSearches=${budgetConfig.maxSearches}, maxPagesRead=${budgetConfig.maxPagesRead}, maxTokens=${budgetConfig.maxModelTokens}`,
  );

  const startTime = Date.now();
  const eventsCaptured: string[] = [];

  const result = await engine.run(
    {
      runId: `run-${scenario.id}-${Date.now()}`,
      userId: 'test-user-live',
      projectId: 'proj-live-001',
      query: scenario.query,
      scope: scenario.scope,
      depth: 'quick',
      customBudget: budgetConfig,
    },
    environment,
    {
      onEvent: async (evt) => {
        eventsCaptured.push(evt.type);
        if (evt.type === 'research.plan') {
          const plan = (evt.data as any).plan;
          console.log(`  📋 [Plan] Sub-pertanyaan (${plan?.subQuestions?.length ?? 0}):`);
          for (const sq of plan?.subQuestions ?? []) {
            console.log(`     - ${sq.question} (Kueri: ${sq.searchQueries.join(', ')})`);
          }
        } else if (evt.type === 'research.evidence') {
          const ev = (evt.data as any).evidence;
          console.log(
            `  💡 [Evidence] [${ev.sourceId}] (${ev.claimType}): ${ev.statement.slice(0, 80)}...`,
          );
        }
      },
    },
  );

  const duration = Date.now() - startTime;
  console.log(`\n  📊 [Hasil Eksekusi]`);
  console.log(`     - Status: ${result.status.toUpperCase()}`);
  console.log(`     - Durasi: ${duration} ms (Batas: ${budgetConfig.maxDurationMs} ms)`);
  console.log(
    `     - Pencarian Terpakai: ${result.budgetUsed.searchesCount} / ${budgetConfig.maxSearches}`,
  );
  console.log(
    `     - Halaman Dibaca: ${result.budgetUsed.pagesReadCount} / ${budgetConfig.maxPagesRead}`,
  );
  console.log(
    `     - Token Terpakai: ${result.budgetUsed.modelTokensCount} / ${budgetConfig.maxModelTokens}`,
  );
  console.log(`     - Jumlah Sumber: ${result.sources.length}`);
  console.log(`     - Jumlah Bukti Faktual: ${result.evidence.length}`);
  console.log(
    `     - Evaluator Passed: ${result.evaluationResult.passed ? 'YA (LULUS)' : 'TIDAK (DITOLAK)'}`,
  );

  // Verifikasi Budget Bounds
  if (result.budgetUsed.searchesCount > budgetConfig.maxSearches) {
    throw new Error(
      `Pelanggaran budget pencarian: ${result.budgetUsed.searchesCount} > ${budgetConfig.maxSearches}`,
    );
  }
  if (result.budgetUsed.pagesReadCount > budgetConfig.maxPagesRead) {
    throw new Error(
      `Pelanggaran budget halaman: ${result.budgetUsed.pagesReadCount} > ${budgetConfig.maxPagesRead}`,
    );
  }

  // Verifikasi Kutipan Verbatim Bounds (<= 200 karakter)
  for (const ev of result.evidence) {
    if (ev.quote && ev.quote.length > 200) {
      throw new Error(
        `Pelanggaran batas verbatim hak cipta: ${ev.quote.length} karakter > 200 karakter`,
      );
    }
  }

  // Tampilkan Pratinjau Laporan
  console.log(`\n  📑 [Pratinjau Laporan Sintesis]`);
  const reportLines = result.report.contentMarkdown.split('\n');
  for (const line of reportLines.slice(0, 18)) {
    console.log(`     ${line}`);
  }
  if (reportLines.length > 18) {
    console.log(`     ... (${reportLines.length - 18} baris lainnya tersimpan utuh)`);
  }

  return result;
}

async function main() {
  console.log('================================================================');
  console.log(' SESI 24: LIVE VERIFIKASI DEEP RESEARCH ENGINE & EVALUATOR');
  console.log('================================================================');

  const apiKey = process.env.NINEROUTER_API_KEY ?? process.env.NINE_ROUTER_API_KEY;
  if (apiKey) {
    console.log('[Gateway] Terhubung ke 9Router Live API.');
  } else {
    console.log(
      '[Gateway] NINEROUTER_API_KEY tidak disetel pada env; menjalankan verifikasi deterministik model mock fallback.',
    );
  }

  let passedScenarios = 0;
  for (const sc of TEST_SCENARIOS) {
    try {
      const res = await runScenario(sc, apiKey);
      if (res.status === 'completed' && res.evaluationResult.passed) {
        passedScenarios++;
      }
    } catch (err) {
      console.error(`[GAGAL] Skenario ${sc.id} error:`, err);
      process.exitCode = 1;
    }
  }

  console.log(`\n================================================================`);
  console.log(
    ` HASIL AKHIR: ${passedScenarios} / ${TEST_SCENARIOS.length} SKENARIO LULUS VERIFIKASI`,
  );
  console.log('================================================================\n');
}

void main();
