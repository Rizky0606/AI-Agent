import type { IntentAnalysisResult, StepPlan, TaskPlan } from '../types.ts';

export class Planner {
  createPlan(intentResult: IntentAnalysisResult, prompt: string): TaskPlan {
    const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    switch (intentResult.intent) {
      case 'coding':
        return this.createCodingPlan(planId, prompt);
      case 'research':
        return this.createResearchPlan(planId, prompt);
      case 'windows_local':
        return this.createWindowsLocalPlan(planId, prompt);
      case 'heavy_untrusted':
        return this.createSandboxPlan(planId, prompt);
      case 'simple_chat':
      default:
        return this.createChatPlan(planId, prompt);
    }
  }

  private createCodingPlan(planId: string, prompt: string): TaskPlan {
    const steps: StepPlan[] = [
      {
        id: 'step-1-understand',
        stepNumber: 1,
        name: 'understand',
        description:
          'Menganalisis kebutuhan, kriteria keberhasilan, dan batasan teknis dari permintaan pengguna.',
        actionType: 'internal',
        expectedOutput: 'Daftar kebutuhan fungsional dan acceptance criteria yang jelas.',
        acceptanceCriteria: ['Kebutuhan terpetakan', 'Acceptance criteria terdefinisi'],
      },
      {
        id: 'step-2-inspect',
        stepNumber: 2,
        name: 'inspect',
        description:
          'Memeriksa git status dan memastikan perubahan pengguna tidak tertimpa; mengisolasi workspace/branch.',
        actionType: 'workspace_inspection',
        expectedOutput: 'Status working tree bersih atau branch/workspace isolasi telah aktif.',
        acceptanceCriteria: ['Git status diperiksa', 'Perubahan pengguna terlindungi'],
      },
      {
        id: 'step-3-plan',
        stepNumber: 3,
        name: 'plan',
        description:
          'Menyusun rencana langkah teknis, file target yang akan dimodifikasi, dan urutan pengujian.',
        actionType: 'internal',
        expectedOutput: 'Rencana kerja berurutan dengan daftar file target.',
        acceptanceCriteria: ['File target teridentifikasi', 'Urutan kerja sistematis'],
      },
      {
        id: 'step-4-implement',
        stepNumber: 4,
        name: 'implement',
        description: 'Menerapkan perubahan kode secara incremental sesuai rencana.',
        actionType: 'file_operation',
        expectedOutput: 'File kode baru atau modifikasi file yang ada selesai ditulis.',
        acceptanceCriteria: ['Kode ditulis sesuai spesifikasi', 'Tidak ada syntax error'],
      },
      {
        id: 'step-5-test',
        stepNumber: 5,
        name: 'test',
        description: 'Menjalankan lint, typecheck, unit & integration test, dan build.',
        actionType: 'verification',
        expectedOutput: 'Output eksekusi lint, typecheck, test suite, dan build command.',
        acceptanceCriteria: [
          'Lint 0 error',
          'Typecheck 0 error',
          'Tests 100% pass',
          'Build berhasil',
        ],
      },
      {
        id: 'step-6-debug',
        stepNumber: 6,
        name: 'debug',
        description:
          'Jika ada uji gagal, jalankan bounded repair loop (maks N percobaan, catat bukti per loop).',
        actionType: 'repair',
        expectedOutput: 'Bukti perbaikan per iterasi dan status uji ulang.',
        acceptanceCriteria: ['Loop perbaikan terikat batas N', 'Bukti perbaikan tersimpan'],
      },
      {
        id: 'step-7-review-diff',
        stepNumber: 7,
        name: 'review_diff',
        description:
          'Melakukan self-review terhadap diff git untuk memvalidasi hanya perubahan yang diharapkan yang terjadi.',
        actionType: 'internal',
        expectedOutput: 'Daftar file yang berubah dan ringkasan diff.',
        acceptanceCriteria: ['Diff bebas dari bocoran secret atau modifikasi liar'],
      },
      {
        id: 'step-8-document',
        stepNumber: 8,
        name: 'document',
        description: 'Mendokumentasikan perubahan kode, artefak, dan petunjuk verifikasi.',
        actionType: 'internal',
        expectedOutput: 'Dokumentasi perubahan yang jelas.',
        acceptanceCriteria: ['Dokumentasi mencakup ringkasan perubahan'],
      },
      {
        id: 'step-9-report',
        stepNumber: 9,
        name: 'report',
        description:
          'Menyajikan laporan akhir lengkap dan membatasi aksi push/merge/deploy di balik persetujuan (approval).',
        actionType: 'reporting',
        expectedOutput: 'Laporan 8 bagian sesuai standar AGENTS.md.',
        acceptanceCriteria: [
          'Evaluator coding memvalidasi kelulusan',
          'Aksi berdampak tinggi menunggu approval pengguna',
        ],
      },
    ];

    return {
      planId,
      taskKind: 'coding',
      title: `Coding Task: ${prompt.slice(0, 50)}...`,
      objective: prompt,
      steps,
      requiredPermissions: ['workspace:read', 'workspace:write', 'tool:execute_command'],
      estimatedRisk: 'MEDIUM',
    };
  }

  private createResearchPlan(planId: string, prompt: string): TaskPlan {
    const steps: StepPlan[] = [
      {
        id: 'step-1-decompose',
        stepNumber: 1,
        name: 'decompose',
        description: 'Mendekomposisi topik riset menjadi sub-pertanyaan terfokus.',
        actionType: 'internal',
        expectedOutput: 'Daftar sub-pertanyaan dan kata kunci penelusuran.',
        acceptanceCriteria: ['Topik terbagi jelas'],
      },
      {
        id: 'step-2-search',
        stepNumber: 2,
        name: 'search',
        description: 'Melakukan pencarian sumber melalui web search atau sumber literatur.',
        actionType: 'external_tool',
        expectedOutput: 'Daftar URL dan metadata kandidat sumber relevan.',
        acceptanceCriteria: ['Minimal 2 sumber independen'],
      },
      {
        id: 'step-3-browse',
        stepNumber: 3,
        name: 'browse',
        description: 'Menelusuri dan membaca konten halaman web terpilih secara aman.',
        actionType: 'external_tool',
        expectedOutput: 'Isi teks terstruktur dari sumber rujukan.',
        acceptanceCriteria: ['Konten berhasil diekstraksi tanpa pelanggaran SSRF'],
      },
      {
        id: 'step-4-extract',
        stepNumber: 4,
        name: 'extract',
        description: 'Mengekstrak informasi faktual beserta metadata sumber (URL, domain, judul).',
        actionType: 'internal',
        expectedOutput: 'Pernyataan faktual dengan metadata sumber rujukan.',
        acceptanceCriteria: ['Metadata sumber lengkap'],
      },
      {
        id: 'step-5-cross-check',
        stepNumber: 5,
        name: 'cross_check',
        description: 'Mengonfirmasi silang fakta temuan antar sumber independen.',
        actionType: 'internal',
        expectedOutput: 'Verifikasi konsistensi informasi antar sumber.',
        acceptanceCriteria: ['Temuan dikonfirmasi silang'],
      },
      {
        id: 'step-6-source-scoring',
        stepNumber: 6,
        name: 'source_scoring',
        description: 'Menghitung skor kredibilitas setiap sumber (ambang batas >= 0.6).',
        actionType: 'internal',
        expectedOutput: 'Skor kredibilitas per sumber.',
        acceptanceCriteria: ['Skor kredibilitas rata-rata >= 0.6'],
      },
      {
        id: 'step-7-synthesize',
        stepNumber: 7,
        name: 'synthesize',
        description:
          'Mengelompokkan klaim menjadi fakta bersumber, inferensi, atau unverified, serta mendeteksi kontradiksi.',
        actionType: 'internal',
        expectedOutput: 'Klasifikasi klaim dan daftar kontradiksi bila ada.',
        acceptanceCriteria: ['Pemisahan tegas fakta, inferensi, dan unverified'],
      },
      {
        id: 'step-8-cite',
        stepNumber: 8,
        name: 'cite',
        description:
          'Menautkan semua klaim ke ID sumber nyata dan memverifikasi tidak ada sitasi palsu.',
        actionType: 'internal',
        expectedOutput: 'Peta sitasi lengkap tanpa sitasi halusinasi.',
        acceptanceCriteria: ['Tidak ada fabricated citations'],
      },
      {
        id: 'step-9-report',
        stepNumber: 9,
        name: 'report',
        description:
          'Menyusun laporan akhir hasil riset lengkap dengan evaluasi ResearchEvaluator.',
        actionType: 'reporting',
        expectedOutput: 'Laporan komprehensif dengan tabel sitasi dan ringkasan evaluasi.',
        acceptanceCriteria: ['ResearchEvaluator lulus verifikasi'],
      },
    ];

    return {
      planId,
      taskKind: 'research',
      title: `Research Task: ${prompt.slice(0, 50)}...`,
      objective: prompt,
      steps,
      requiredPermissions: ['tool:web_search', 'tool:web_fetch'],
      estimatedRisk: 'LOW',
    };
  }

  private createWindowsLocalPlan(planId: string, prompt: string): TaskPlan {
    return {
      planId,
      taskKind: 'windows_local',
      title: `Windows Local Execution: ${prompt.slice(0, 50)}...`,
      objective: prompt,
      steps: [
        {
          id: 'step-1-local-check',
          stepNumber: 1,
          name: 'verify_device',
          description: 'Memeriksa ketersediaan dan status online agen Windows lokal.',
          actionType: 'internal',
          expectedOutput: 'Status koneksi perangkat Windows terverifikasi.',
          acceptanceCriteria: ['Windows agent online'],
        },
        {
          id: 'step-2-local-execute',
          stepNumber: 2,
          name: 'execute_local',
          description: 'Menjalankan perintah lokal melalui saluran terproteksi allowlist.',
          actionType: 'external_tool',
          expectedOutput: 'Hasil eksekusi lokal dari workstation Windows pengguna.',
          acceptanceCriteria: ['Path dalam allowlist', 'Output dibatasi'],
        },
      ],
      requiredPermissions: ['device:windows_local', 'terminal:powershell'],
      estimatedRisk: 'MEDIUM',
    };
  }

  private createSandboxPlan(planId: string, prompt: string): TaskPlan {
    return {
      planId,
      taskKind: 'heavy_untrusted',
      title: `Sandbox Task: ${prompt.slice(0, 50)}...`,
      objective: prompt,
      steps: [
        {
          id: 'step-1-isolate',
          stepNumber: 1,
          name: 'isolate_environment',
          description: 'Menyiapkan kontainer sandbox terisolasi tanpa akses jaringan privat.',
          actionType: 'internal',
          expectedOutput: 'Sandbox aman siap menerima komputasi.',
          acceptanceCriteria: ['Isolasi network aktif'],
        },
        {
          id: 'step-2-sandbox-run',
          stepNumber: 2,
          name: 'execute_untrusted',
          description: 'Menjalankan pekerjaan komputasi berat / tidak tepercaya dalam sandbox.',
          actionType: 'external_tool',
          expectedOutput: 'Output eksekusi terisolasi.',
          acceptanceCriteria: ['Resource limit ditaati'],
        },
      ],
      requiredPermissions: ['sandbox:execute'],
      estimatedRisk: 'HIGH',
    };
  }

  private createChatPlan(planId: string, prompt: string): TaskPlan {
    return {
      planId,
      taskKind: 'simple_chat',
      title: `Chat: ${prompt.slice(0, 50)}...`,
      objective: prompt,
      steps: [
        {
          id: 'step-1-answer',
          stepNumber: 1,
          name: 'generate_response',
          description: 'Memproses pesan dan mengembalikan jawaban cepat.',
          actionType: 'internal',
          expectedOutput: 'Respons teks percakapan.',
          acceptanceCriteria: ['Pesan terjawab'],
        },
      ],
      requiredPermissions: [],
      estimatedRisk: 'LOW',
    };
  }
}
