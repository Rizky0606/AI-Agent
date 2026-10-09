import { randomUUID } from 'node:crypto';
import { computeApprovalFingerprint } from './fingerprint.ts';
import type {
  ApprovalBinding,
  EvaluationResult,
  PermissionDecision,
  PermissionRequest,
  RiskLevel,
} from './types.ts';

export interface ActionRule {
  pattern: RegExp;
  baseRisk: RiskLevel;
  consequence: string;
  allowWithoutApproval?: boolean | undefined;
}

const DEFAULT_ACTION_RULES: ActionRule[] = [
  // LOW: Read / search / analysis
  {
    pattern: /^(tool|fs|knowledge):(read|search|analyze|list|inspect)/i,
    baseRisk: 'LOW',
    consequence: 'Membaca atau menganalisis data tanpa perubahan state.',
    allowWithoutApproval: true,
  },
  {
    pattern: /^(query|model):/i,
    baseRisk: 'LOW',
    consequence: 'Menjalankan kueri informasi atau model inference.',
    allowWithoutApproval: true,
  },
  {
    pattern: /^(browser):(navigate|screenshot|inspect|read|extract)/i,
    baseRisk: 'LOW',
    consequence: 'Navigasi atau inspeksi visual halaman web.',
    allowWithoutApproval: true,
  },
  {
    pattern: /^(web):(search|fetch)/i,
    baseRisk: 'LOW',
    consequence: 'Pencarian web atau pengambilan konten halaman web publik.',
    allowWithoutApproval: true,
  },
  {
    pattern: /^(artifact):(read|list|download)/i,
    baseRisk: 'LOW',
    consequence: 'Membaca atau mengunduh artefak yang diizinkan.',
    allowWithoutApproval: true,
  },

  // MEDIUM: Modify workspace / allowed commands
  {
    pattern: /^(tool|fs):(write|edit|create|update)/i,
    baseRisk: 'MEDIUM',
    consequence: 'Mengubah file atau konten di dalam workspace terdaftar.',
    allowWithoutApproval: true,
  },
  {
    pattern: /^(browser):(click|type|scroll)/i,
    baseRisk: 'MEDIUM',
    consequence: 'Interaksi dasar halaman web dalam sesi browser.',
    allowWithoutApproval: true,
  },
  {
    pattern: /^(artifact):(write|save|create|upload|delete)/i,
    baseRisk: 'MEDIUM',
    consequence: 'Membuat atau memodifikasi artefak di dalam storage.',
    allowWithoutApproval: true,
  },
  {
    pattern: /^git:(commit|add|status|diff|branch)/i,
    baseRisk: 'MEDIUM',
    consequence: 'Melakukan operasi Git lokal di dalam workspace.',
    allowWithoutApproval: true,
  },
  {
    pattern: /^tool:exec_local_command$/i,
    baseRisk: 'MEDIUM',
    consequence: 'Menjalankan perintah lokal di lingkungan workspace.',
    allowWithoutApproval: true,
  },

  // HIGH: External communication, git push, deployment
  {
    pattern: /^git:push/i,
    baseRisk: 'HIGH',
    consequence: 'Mendorong perubahan kode ke remote repository Git eksternal.',
    allowWithoutApproval: false,
  },
  {
    pattern: /^(external|msg):send/i,
    baseRisk: 'HIGH',
    consequence: 'Mengirimkan pesan atau notifikasi ke pihak/layanan eksternal.',
    allowWithoutApproval: false,
  },
  {
    pattern: /^(deploy|release):/i,
    baseRisk: 'HIGH',
    consequence: 'Menjalankan deployment atau memicu pipeline rilis.',
    allowWithoutApproval: false,
  },
  {
    pattern: /^tool:(access_secrets|get_credentials)/i,
    baseRisk: 'HIGH',
    consequence: 'Mengakses token atau kredensial sensitif sistem.',
    allowWithoutApproval: false,
  },
  {
    pattern: /^(browser):(submit|login|download|authenticate)/i,
    baseRisk: 'HIGH',
    consequence:
      'Menjalankan interaksi formulir sensitif, login kredensial, atau unduhan file eksternal dari web.',
    allowWithoutApproval: false,
  },

  // CRITICAL: Destructive operations, drop database, system modification
  {
    pattern: /^(db|database):(drop|truncate|delete_database)/i,
    baseRisk: 'CRITICAL',
    consequence: 'Operasi destruktif yang dapat menghilangkan data database secara permanen.',
    allowWithoutApproval: false,
  },
  {
    pattern: /^(system|admin):(shutdown|reboot|exec_elevated|rmdir_root)/i,
    baseRisk: 'CRITICAL',
    consequence: 'Perubahan sistem tingkat tinggi yang berdampak luas pada host.',
    allowWithoutApproval: false,
  },
  {
    pattern: /^auth:(revoke_all|change_master_key)/i,
    baseRisk: 'CRITICAL',
    consequence: 'Mengubah atau mencabut kredensial otorisasi utama.',
    allowWithoutApproval: false,
  },
];

export class PermissionEngine {
  private readonly rules: ActionRule[];

  constructor(customRules?: ActionRule[]) {
    this.rules = customRules ?? DEFAULT_ACTION_RULES;
  }

  evaluate(request: PermissionRequest): EvaluationResult {
    const evaluationId = randomUUID();

    // 1. Role-based baseline check
    if (request.actor.role === 'guest') {
      return {
        decision: 'deny',
        reason: 'Akses ditolak: role guest tidak memiliki izin eksekusi tindakan.',
        riskLevel: 'HIGH',
        evaluationId,
      };
    }

    // 2. Find matching rule
    const matchedRule = this.rules.find((r) => r.pattern.test(request.action));
    const context = request.context ?? {};

    // 3. Deny-by-default for unrecognized actions
    if (!matchedRule) {
      const riskLevel: RiskLevel = context.isDestructive ? 'CRITICAL' : 'HIGH';
      return {
        decision: 'deny',
        reason: `Akses ditolak (deny-by-default): aksi '${request.action}' tidak dikenali dalam kebijakan keamanan.`,
        riskLevel,
        evaluationId,
      };
    }

    // 4. Context-based escalation
    let effectiveRisk = matchedRule.baseRisk;
    let escalationReason = '';

    if (context.isDestructive === true) {
      effectiveRisk = 'CRITICAL';
      escalationReason = ' (dieskalasi ke CRITICAL karena operasi ditandai destruktif)';
    } else if (context.environment === 'production' && effectiveRisk !== 'LOW') {
      effectiveRisk = effectiveRisk === 'MEDIUM' ? 'HIGH' : 'CRITICAL';
      escalationReason = ' (dieskalasi karena dijalankan di lingkungan production)';
    }

    // 5. Decision resolution based on effective risk and action impact
    let decision: PermissionDecision;
    let reason: string;
    let requiredApproval: ApprovalBinding | undefined;

    if (effectiveRisk === 'LOW') {
      decision = 'allow';
      reason = `Aksi '${request.action}' diizinkan (risiko LOW).`;
    } else if (effectiveRisk === 'MEDIUM') {
      // If outside workspace scope, escalate to require approval
      if (request.scope !== 'workspace' && request.scope !== 'sandbox') {
        decision = 'require_approval';
        reason = `Aksi '${request.action}' pada scope '${request.scope}' memerlukan persetujuan pengguna.`;
      } else {
        decision = 'allow';
        reason = `Aksi '${request.action}' diizinkan di dalam scope '${request.scope}' (risiko MEDIUM).`;
      }
    } else {
      // HIGH and CRITICAL always require approval
      decision = 'require_approval';
      reason = `Aksi '${request.action}' berisiko ${effectiveRisk}${escalationReason}: ${matchedRule.consequence}`;
    }

    if (decision === 'require_approval') {
      requiredApproval = {
        action: request.action,
        resource: request.resource,
        scope: request.scope,
        riskLevel: effectiveRisk,
        consequence: `${matchedRule.consequence}${escalationReason}`,
        fingerprint: computeApprovalFingerprint(
          request.action,
          request.resource,
          request.scope,
          effectiveRisk,
          request.context,
        ),
      };
    }

    return {
      decision,
      reason,
      riskLevel: effectiveRisk,
      evaluationId,
      requiredApproval,
    };
  }
}
