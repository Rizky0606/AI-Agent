import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRouter, IntentAnalyzer, Planner } from '../src/index.ts';

test('IntentAnalyzer: classifies intents into appropriate categories', () => {
  const analyzer = new IntentAnalyzer();

  // Simple chat
  const chat1 = analyzer.analyze('Halo apa kabar? Bisakah kamu membantuku hari ini?');
  assert.equal(chat1.intent, 'simple_chat');
  assert.equal(chat1.recommendedRuntime, 'fast_model');

  // Coding
  const coding1 = analyzer.analyze(
    'Tolong perbaiki bug pada auth service di repo backend dan jalankan unit test',
  );
  assert.equal(coding1.intent, 'coding');
  assert.equal(coding1.recommendedRuntime, 'repo_runtime');

  // Research
  const research1 = analyzer.analyze(
    'Lakukan riset perbandingan arsitektur microservices vs monolith beserta sumber dan sitasi',
  );
  assert.equal(research1.intent, 'research');
  assert.equal(research1.recommendedRuntime, 'repo_runtime');

  // Windows Local
  const local1 = analyzer.analyze(
    'Jalankan skrip powershell lokal di komputer saya untuk membaca C:\\logs',
  );
  assert.equal(local1.intent, 'windows_local');
  assert.equal(local1.recommendedRuntime, 'windows_agent');

  // Heavy / Untrusted Sandbox
  const sandbox1 = analyzer.analyze(
    'Jalankan skrip python tidak tepercaya ini di dalam lingkungan sandbox isolasi ketat',
  );
  assert.equal(sandbox1.intent, 'heavy_untrusted');
  assert.equal(sandbox1.recommendedRuntime, 'sandbox');
});

test('Planner: creates comprehensive 9-step plan for coding and research', () => {
  const analyzer = new IntentAnalyzer();
  const planner = new Planner();

  // Coding Plan
  const codingIntent = analyzer.analyze('Perbaiki fungsi kalkulasi diskon di repo shop');
  const codingPlan = planner.createPlan(codingIntent, 'Perbaiki fungsi diskon');

  assert.equal(codingPlan.taskKind, 'coding');
  assert.equal(codingPlan.steps.length, 9);
  const stepNames = codingPlan.steps.map((s) => s.name);
  assert.deepEqual(stepNames, [
    'understand',
    'inspect',
    'plan',
    'implement',
    'test',
    'debug',
    'review_diff',
    'document',
    'report',
  ]);

  // Research Plan
  const researchIntent = analyzer.analyze('Riset mengenai perbandingan PostgreSQL vs SQLite');
  const researchPlan = planner.createPlan(researchIntent, 'Riset database');

  assert.equal(researchPlan.taskKind, 'research');
  assert.equal(researchPlan.steps.length, 9);
  const researchStepNames = researchPlan.steps.map((s) => s.name);
  assert.deepEqual(researchStepNames, [
    'decompose',
    'search',
    'browse',
    'extract',
    'cross_check',
    'source_scoring',
    'synthesize',
    'cite',
    'report',
  ]);
});

test('AgentRouter: routes tasks to appropriate model, runtime, and handles device offline status', () => {
  const router = new AgentRouter();

  // Fast chat
  const chatRes = router.route('Halo selamat pagi', { userId: 'u1' });
  assert.equal(chatRes.route.intent, 'simple_chat');
  assert.equal(chatRes.route.runtime, 'fast_model');
  assert.equal(chatRes.route.modelId, 'glm-4-flash');

  // Coding route
  const codingRes = router.route('Buatkan endpoint Fastify baru', { userId: 'u1' });
  assert.equal(codingRes.route.intent, 'coding');
  assert.equal(codingRes.route.runtime, 'repo_runtime');
  assert.equal(codingRes.route.modelId, 'claude-3-7-sonnet');
  assert.equal(codingRes.route.maxAttempts, 3);

  // Research route
  const researchRes = router.route('Riset mendalam perbandingan Redis vs Dragonfly', {
    userId: 'u1',
  });
  assert.equal(researchRes.route.intent, 'research');
  assert.equal(researchRes.route.modelId, 'gemini-2.5-pro');

  // Windows Local - Offline scenario
  const offlineLocalRes = router.route('Jalankan powershell lokal di komputer saya', {
    userId: 'u1',
    isWindowsOnline: false,
  });
  assert.equal(offlineLocalRes.route.intent, 'windows_local');
  assert.equal(offlineLocalRes.route.requiresWindowsAgent, true);
  assert.match(offlineLocalRes.route.reason, /OFFLINE/);

  // Heavy untrusted - Sandbox unavailable scenario
  const sandboxRes = router.route('Jalankan evaluasi sandbox kode asing', {
    userId: 'u1',
    isSandboxAvailable: false,
  });
  assert.equal(sandboxRes.route.intent, 'heavy_untrusted');
  assert.equal(sandboxRes.route.requiresSandbox, true);
  assert.match(sandboxRes.route.reason, /sandbox isolasi belum tersedia/i);
});

test('AgentRouter: policy-based routing to omp, hermes, and native', () => {
  const router = new AgentRouter();

  // Coding -> omp
  const codingRes = router.route('Perbaiki bug syntax di repo frontend', { userId: 'u1' });
  assert.equal(codingRes.route.intent, 'coding');
  assert.equal(codingRes.route.selectedRuntimeId, 'omp');

  // Automation / Skill -> hermes
  const autoRes = router.route('Jalankan otomasi jadwal workflow telegram bot', { userId: 'u1' });
  assert.equal(autoRes.route.intent, 'automation');
  assert.equal(autoRes.route.selectedRuntimeId, 'hermes');
  assert.equal(autoRes.plan.taskKind, 'automation');

  // Simple chat -> native
  const chatRes = router.route('Halo selamat malam', { userId: 'u1' });
  assert.equal(chatRes.route.intent, 'simple_chat');
  assert.equal(chatRes.route.selectedRuntimeId, 'native');
});

test('AgentRouter: user runtime overrides bypass intent-based defaults', () => {
  const router = new AgentRouter();

  // Prompt is coding, but user overrides with 'hermes'
  const overrideHermes = router.route('Perbaiki bug syntax di repo frontend', {
    userId: 'u1',
    preferredRuntimeId: 'hermes',
  });
  assert.equal(overrideHermes.route.intent, 'coding');
  assert.equal(overrideHermes.route.selectedRuntimeId, 'hermes');

  // Prompt is automation, but user overrides with 'omp'
  const overrideOmp = router.route('Jalankan workflow otomasi berkala', {
    userId: 'u1',
    preferredRuntimeId: 'omp',
  });
  assert.equal(overrideOmp.route.intent, 'automation');
  assert.equal(overrideOmp.route.selectedRuntimeId, 'omp');

  // User explicitly selects 'native'
  const overrideNative = router.route('Perbaiki fungsi kalkulasi di repo', {
    userId: 'u1',
    preferredRuntimeId: 'native',
  });
  assert.equal(overrideNative.route.selectedRuntimeId, 'native');
});

test('AgentRouter: routeWithHealth triggers explicit fallback when primary runtime is unhealthy', async () => {
  const mockManager = {
    getAllRuntimes() {
      return [{ id: 'omp' }, { id: 'hermes' }];
    },
    getRuntime(id: string) {
      if (id === 'omp' || id === 'hermes') return {} as never;
      return undefined;
    },
    async healthCheck(id: string) {
      if (id === 'omp') {
        return { healthy: false, error: 'OMP socket connection refused' };
      }
      if (id === 'hermes') {
        return { healthy: true };
      }
      return { healthy: true };
    },
  };

  const router = new AgentRouter(undefined, undefined, mockManager as never);

  // Coding would normally route to 'omp', but 'omp' is unhealthy -> falls back to 'hermes'
  const result = await router.routeWithHealth('Perbaiki bug di repo auth', { userId: 'u1' });
  assert.equal(result.route.selectedRuntimeId, 'hermes');
  assert.equal(result.route.fallbackUsed, true);
  assert.equal(result.route.originalRuntimeId, 'omp');
  assert.ok(result.route.fallbackReason?.includes('omp'));
  assert.ok(result.route.fallbackReason?.includes('hermes'));
});

test('AgentRouter: routeWithHealth falls back to native when both external runtimes are unhealthy', async () => {
  const mockManager = {
    getAllRuntimes() {
      return [{ id: 'omp' }, { id: 'hermes' }];
    },
    getRuntime(id: string) {
      if (id === 'omp' || id === 'hermes') return {} as never;
      return undefined;
    },
    async healthCheck(id: string) {
      return { healthy: false, error: `${id} is down` };
    },
  };

  const router = new AgentRouter(undefined, undefined, mockManager as never);

  const result = await router.routeWithHealth('Jalankan skrip otomasi workflow telegram', { userId: 'u1' });
  assert.equal(result.route.selectedRuntimeId, 'native');
  assert.equal(result.route.fallbackUsed, true);
  assert.equal(result.route.originalRuntimeId, 'hermes');
  assert.ok(result.route.fallbackReason?.includes('native'));
});

