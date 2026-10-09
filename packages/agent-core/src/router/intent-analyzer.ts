import type { IntentAnalysisResult } from '../types.ts';

export class IntentAnalyzer {
  analyze(prompt: string): IntentAnalysisResult {
    const trimmed = prompt.trim();
    const lower = trimmed.toLowerCase();

    // 1. Check for Heavy / Untrusted / Sandbox intent first
    const isUntrusted =
      lower.includes('untrusted') ||
      lower.includes('sandbox') ||
      lower.includes('isolasi ketat') ||
      lower.includes('heavy batch') ||
      lower.includes('script asing') ||
      lower.includes('kode tidak tepercaya');

    if (isUntrusted) {
      return {
        intent: 'heavy_untrusted',
        confidence: 0.95,
        recommendedRuntime: 'sandbox',
        reasoning:
          'Permintaan menginstruksikan eksekusi kode tidak tepercaya atau pekerjaan komputasi terisolasi sandbox.',
        extractedEntities: {
          isUntrusted: true,
        },
      };
    }

    // 2. Check for Windows Local Agent intent
    const isLocalWindows =
      lower.includes('windows lokal') ||
      lower.includes('komputer saya') ||
      lower.includes('laptop saya') ||
      lower.includes('powershell lokal') ||
      lower.includes('c:\\') ||
      lower.includes('local machine') ||
      lower.includes('desktop saya');

    if (isLocalWindows) {
      return {
        intent: 'windows_local',
        confidence: 0.92,
        recommendedRuntime: 'windows_agent',
        reasoning: 'Permintaan menargetkan eksekusi lokal pada perangkat Windows pengguna.',
        extractedEntities: {
          isLocalRequired: true,
        },
      };
    }

    // 3. Check for Coding intent
    const codingKeywords = [
      'bug',
      'kode',
      'code',
      'fix',
      'perbaiki',
      'refactor',
      'implementasi',
      'implement',
      'test',
      'lint',
      'typecheck',
      'build',
      'function',
      'git',
      'commit',
      'diff',
      'repo',
      'repository',
      'endpoint',
      'api',
      'class',
      'typescript',
      'javascript',
      'pull request',
      'pr',
    ];

    const hasCodingKeywords = codingKeywords.some((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      return regex.test(lower);
    });

    if (hasCodingKeywords) {
      // Extract possible branch or repo mentions
      let repoPath: string | undefined;
      const pathMatch = prompt.match(/(?:di|dalam|repo|path)\s+([a-zA-Z0-9_./\\-]+)/i);
      if (pathMatch?.[1]) {
        repoPath = pathMatch[1];
      }

      return {
        intent: 'coding',
        confidence: 0.9,
        recommendedRuntime: 'repo_runtime',
        reasoning:
          'Permintaan melibatkan manipulasi kode sumber, perbaikan bug, atau inspeksi repositori.',
        extractedEntities: {
          repoPath,
        },
      };
    }

    // 4. Check for Research intent
    const researchKeywords = [
      'riset',
      'research',
      'cari informasi',
      'investigasi',
      'sumber',
      'sitasi',
      'perbandingan',
      'compare',
      'deep dive',
      'literatur',
      'benchmark',
      'analisis pasar',
      'fakta',
    ];

    const hasResearchKeywords = researchKeywords.some((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      return regex.test(lower);
    });

    if (hasResearchKeywords) {
      // Extract topics
      const topics: string[] = [];
      const topicMatch = prompt.match(/(?:tentang|mengenai|topik|riset)\s+([^,.\n]+)/i);
      if (topicMatch?.[1]) {
        topics.push(topicMatch[1].trim());
      }

      return {
        intent: 'research',
        confidence: 0.88,
        recommendedRuntime: 'repo_runtime', // Uses repo runtime / background search runner
        reasoning:
          'Permintaan memerlukan penelusuran multi-sumber, pencarian informasi, sintesis, dan sitasi.',
        extractedEntities: {
          topics: topics.length > 0 ? topics : [trimmed],
        },
      };
    }

    // 5. Default to Simple Chat
    return {
      intent: 'simple_chat',
      confidence: 0.95,
      recommendedRuntime: 'fast_model',
      reasoning: 'Permintaan adalah percakapan umum yang dapat ditangani model respons cepat.',
      extractedEntities: {},
    };
  }
}
