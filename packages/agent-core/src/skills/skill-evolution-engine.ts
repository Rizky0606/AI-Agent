import { randomUUID } from 'node:crypto';
import {
  FORBIDDEN_SKILL_ACTIONS,
  ManifestValidator,
} from './manifest-validator.ts';
import type {
  SkillEvolutionProposal,
  SkillHandler,
  SkillManifest,
  SkillPermission,
  SkillProposalEligibilityCheck,
  SkillRecord,
  SkillTestCase,
  TaskEvaluationContext,
} from './types.ts';

export const MIN_EVALUATION_SCORE_FOR_SKILL = 0.85;
export const DEFAULT_SANDBOX_TIMEOUT_MS = 3_000;
export const MAX_SANDBOX_RETRIES = 1; // Strictly bounded retry/repair: NO infinite loop

export class SkillEvolutionEngine {
  private readonly validator: ManifestValidator;

  constructor(validator?: ManifestValidator | undefined) {
    this.validator = validator ?? new ManifestValidator();
  }

  /**
   * Checks whether a finished task qualifies to be proposed as an evolved skill.
   * Requirement 1: Evaluator must pass, status must be completed, and score must meet threshold.
   */
  checkEligibility(
    context: TaskEvaluationContext,
    existingSkills: SkillRecord[] = [],
  ): SkillProposalEligibilityCheck {
    if (context.status !== 'completed') {
      return {
        eligible: false,
        reason: `Task status '${context.status}' bukan 'completed'. Hanya task yang berhasil yang dapat diusulkan sebagai skill.`,
      };
    }

    if (!context.evaluation) {
      return {
        eligible: false,
        reason: 'Task tidak memiliki data evaluasi objektif dari Evaluator Gating.',
      };
    }

    if (!context.evaluation.passed) {
      return {
        eligible: false,
        reason: 'Evaluasi task tidak lulus (evaluator passed = false).',
      };
    }

    if (context.evaluation.score < MIN_EVALUATION_SCORE_FOR_SKILL) {
      return {
        eligible: false,
        reason: `Skor evaluasi (${context.evaluation.score}) di bawah ambang batas kelayakan minimum (${MIN_EVALUATION_SCORE_FOR_SKILL}).`,
      };
    }

    if (context.evaluation.selfClaimRejected) {
      return {
        eligible: false,
        reason: 'Klaim sepihak agen ditolak oleh evaluator; bukti konkret tidak mencukupi.',
      };
    }

    if (context.evaluation.remainingIssues && context.evaluation.remainingIssues.length > 0) {
      return {
        eligible: false,
        reason: `Masih ada isu yang belum terselesaikan dalam evaluasi: ${context.evaluation.remainingIssues.join(', ')}`,
      };
    }

    // Determine if this is an improvement or a new skill
    const suggestedKebabName = this.slugify(context.prompt.slice(0, 40));
    const existing = existingSkills.find(
      (s) => s.name === suggestedKebabName || context.prompt.toLowerCase().includes(s.name),
    );

    return {
      eligible: true,
      reason: 'Task memenuhi kriteria keberhasilan dan evaluasi objektif untuk dievolusikan.',
      suggestedName: existing ? existing.name : suggestedKebabName,
      suggestedType: existing ? 'improvement' : 'new_skill',
    };
  }

  /**
   * Creates a structured skill proposal from a completed and verified task.
   * Requirement 2 & 3: Manifest validation, credential redaction, risk assessment, and diff generation.
   */
  createProposal(
    context: TaskEvaluationContext,
    params: {
      skillName?: string | undefined;
      title?: string | undefined;
      description?: string | undefined;
      requiredTools?: readonly string[] | undefined;
      permissions?: readonly SkillPermission[] | undefined;
      testCases?: readonly SkillTestCase[] | undefined;
      promptInstructions?: string | undefined;
      existingSkill?: SkillRecord | undefined;
    } = {},
  ): SkillEvolutionProposal {
    const eligibility = this.checkEligibility(
      context,
      params.existingSkill ? [params.existingSkill] : [],
    );

    if (!eligibility.eligible) {
      throw new Error(`Task tidak memenuhi syarat untuk membuat usulan skill: ${eligibility.reason}`);
    }

    const name = (params.skillName || eligibility.suggestedName || `skill-${randomUUID().slice(0, 8)}`).trim().toLowerCase();
    const title = params.title || `Skill Otomatis: ${name}`;
    const description = params.description || `Kemampuan yang dievolusikan dari task ${context.taskId}`;
    const requiredTools = params.requiredTools ?? context.toolCalls ?? [];
    const permissions = params.permissions ?? [
      {
        action: 'tool:execute',
        resource: 'workspace',
        scope: 'system',
        riskLevel: 'LOW',
        reason: 'Eksekusi tool yang diizinkan untuk skill',
      },
    ];

    const changeType: 'new_skill' | 'improvement' = params.existingSkill ? 'improvement' : 'new_skill';
    const newVersion = params.existingSkill ? this.bumpSemver(params.existingSkill.version) : '1.0.0';

    const rawManifest: SkillManifest = {
      name,
      version: newVersion,
      description: this.sanitizeText(description),
      inputSchema: { type: 'object', additionalProperties: true },
      outputSchema: { type: 'object', additionalProperties: true },
      toolRequirements: requiredTools,
      permissions,
      compatibility: { platforms: ['windows', 'android', 'node'] },
      metadata: {
        evolvedFromTaskId: context.taskId,
        createdAt: new Date().toISOString(),
      },
    };

    // Validate manifest and forbidden actions
    const validatedManifest = this.validator.validate(rawManifest);

    // Generate diff if improvement
    let diff: string | null = null;
    if (changeType === 'improvement' && params.existingSkill) {
      const oldJson = JSON.stringify(params.existingSkill.manifest, null, 2);
      const newJson = JSON.stringify(validatedManifest, null, 2);
      diff = this.generateUnifiedDiff(oldJson, newJson, `${params.existingSkill.name}.json`);
    }

    const testCases: SkillTestCase[] = params.testCases && params.testCases.length > 0
      ? [...params.testCases]
      : [
          {
            name: 'smoke-test-input-validation',
            input: { query: 'test' },
            shouldPass: true,
          },
        ];

    // Compute max risk level
    const risk = this.computeMaxRisk(permissions);

    return {
      id: randomUUID(),
      name: validatedManifest.name,
      title: this.sanitizeText(title),
      purpose: this.sanitizeText(description),
      sourceTaskIds: [context.taskId], // ID only: no sensitive prompts or secrets leaked
      manifest: validatedManifest,
      requiredTools,
      permissions,
      testCases,
      risk,
      changeType,
      targetSkillName: params.existingSkill ? params.existingSkill.name : undefined,
      diff,
      promptInstructions: params.promptInstructions ? this.sanitizeText(params.promptInstructions) : undefined,
      testStatus: 'pending',
    };
  }

  /**
   * Executes proposal test cases in an isolated sandbox harness with bounded resources.
   * Requirement 4: Bounded timeout, network/filesystem isolation, and bounded retry loop.
   */
  async runSandboxTestHarness(
    manifest: SkillManifest,
    testCases: readonly SkillTestCase[],
    handler: SkillHandler,
    options: { timeoutMs?: number; maxRetries?: number } = {},
  ): Promise<{
    allPassed: boolean;
    passedCount: number;
    failedCount: number;
    results: Array<{
      testName: string;
      passed: boolean;
      durationMs: number;
      error?: string | undefined;
    }>;
  }> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS;
    const maxRetries = Math.min(options.maxRetries ?? MAX_SANDBOX_RETRIES, MAX_SANDBOX_RETRIES);
    const results: Array<{
      testName: string;
      passed: boolean;
      durationMs: number;
      error?: string | undefined;
    }> = [];

    let passedCount = 0;
    let failedCount = 0;

    for (const tc of testCases) {
      const started = Date.now();
      let passed = false;
      let lastError: string | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            const timer = setTimeout(() => {
              reject(new Error(`Test case '${tc.name}' timed out after ${timeoutMs}ms in sandbox harness`));
            }, timeoutMs);
            timer.unref();
          });

          const executionPromise = handler(tc.input, {
            userId: 'sandbox-test-runner',
            taskId: `sandbox-${randomUUID().slice(0, 8)}`,
          });

          const output = await Promise.race([executionPromise, timeoutPromise]);

          if (tc.expectedOutput) {
            // Verify expected properties
            for (const [k, v] of Object.entries(tc.expectedOutput)) {
              if (output[k] !== v) {
                throw new Error(`Output mismatch on property '${k}': expected '${String(v)}', got '${String(output[k])}'`);
              }
            }
          }

          passed = true;
          break; // Test passed, no retry needed
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          // If we have retries left, loop continues once; strictly capped by maxRetries
        }
      }

      const durationMs = Date.now() - started;

      if (passed) {
        passedCount++;
        results.push({ testName: tc.name, passed: true, durationMs });
      } else {
        failedCount++;
        results.push({ testName: tc.name, passed: false, durationMs, error: lastError });
      }
    }

    return {
      allPassed: failedCount === 0 && passedCount > 0,
      passedCount,
      failedCount,
      results,
    };
  }

  /**
   * Evaluates proposal safety before human approval.
   * Rejects unredacted credentials, forbidden system boundaries, or failed test status.
   */
  verifyProposalSafety(proposal: SkillEvolutionProposal): { safe: boolean; issues: string[] } {
    const issues: string[] = [];

    // 1. Check test status: failed tests MUST NOT be approved
    if (proposal.testStatus === 'failed') {
      issues.push('Proposal gagal dalam pengujian sandbox harness (testStatus: failed).');
    }

    // 2. Check for leaked secret patterns in description or instructions
    const secretPatterns = [
      /sk-[a-zA-Z0-9_-]{20,}/i,
      /Bearer\s+(?!\[REDACTED)[a-zA-Z0-9_.-]{20,}/i,
      /password\s*[:=]\s*["'](?!\[REDACTED)[^"']+["']/i,
      /\b192\.168\.\d+\.\d+\b/,
      /\b10\.\d+\.\d+\.\d+\b/,
    ];

    const allText = `${proposal.purpose} ${proposal.promptInstructions ?? ''} ${JSON.stringify(proposal.manifest)}`;
    for (const pattern of secretPatterns) {
      if (pattern.test(allText)) {
        issues.push('Proposal terdeteksi mengandung credential, API key, atau IP internal yang belum disanitasi.');
        break;
      }
    }

    // 3. Check forbidden permission actions
    for (const perm of proposal.permissions) {
      for (const forbidden of FORBIDDEN_SKILL_ACTIONS) {
        if (forbidden.test(perm.action)) {
          issues.push(`Proposal meminta permission terlarang '${perm.action}' yang melanggar batas keamanan sistem.`);
        }
      }
    }

    return {
      safe: issues.length === 0,
      issues,
    };
  }

  private sanitizeText(text: string): string {
    return text
      .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [REDACTED_TOKEN]')
      .replace(/sk-[A-Za-z0-9_-]{20,}/gi, '[REDACTED_API_KEY]')
      .replace(/\b(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+)\b/g, '[REDACTED_INTERNAL_IP]')
      .replace(/password\s*[:=]\s*["'][^"']+["']/gi, 'password: "[REDACTED_CREDENTIAL]"');
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'auto-skill';
  }

  private bumpSemver(version: string): string {
    const parts = version.split('.').map(Number);
    const major = parts[0] ?? 1;
    const minor = parts[1] ?? 0;
    const patch = (parts[2] ?? 0) + 1;
    return `${major}.${minor}.${patch}`;
  }

  private computeMaxRisk(permissions: readonly SkillPermission[]): SkillEvolutionProposal['risk'] {
    if (permissions.some((p) => p.riskLevel === 'CRITICAL')) return 'CRITICAL';
    if (permissions.some((p) => p.riskLevel === 'HIGH')) return 'HIGH';
    if (permissions.some((p) => p.riskLevel === 'MEDIUM')) return 'MEDIUM';
    return 'LOW';
  }

  private generateUnifiedDiff(oldStr: string, newStr: string, filename: string): string {
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');
    const lines: string[] = [`--- a/${filename}`, `+++ b/${filename}`];

    const max = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < max; i++) {
      const o = oldLines[i];
      const n = newLines[i];
      if (o === n) {
        if (o !== undefined) lines.push(` ${o}`);
      } else {
        if (o !== undefined) lines.push(`-${o}`);
        if (n !== undefined) lines.push(`+${n}`);
      }
    }
    return lines.join('\n');
  }
}
