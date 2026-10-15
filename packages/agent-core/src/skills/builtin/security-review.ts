import type { SkillHandler, SkillManifest } from '../types.ts';

export type SecuritySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type SecurityCategory = 'secret_leak' | 'injection' | 'excessive_permission';

export interface SecurityFinding {
  severity: SecuritySeverity;
  category: SecurityCategory;
  description: string;
  lineHint?: string | undefined;
}

export interface SecurityReviewInput {
  contentOrDiff: string;
  targetResource?: string | undefined;
  requestedPermissions?: string[] | undefined;
}

export interface SecurityReviewOutput {
  approved: boolean;
  riskScore: number; // 0 - 100
  criticalIssuesCount: number;
  findings: SecurityFinding[];
  recommendations: string[];
}

export const SECURITY_REVIEW_MANIFEST: SkillManifest = {
  name: 'security-review',
  version: '1.0.0',
  description:
    'Memeriksa perubahan kode, diff, atau konfigurasi terhadap kebocoran rahasia (secrets), pola injeksi (command/SQL/path), dan permintaan izin berlebih (excessive permissions).',
  inputSchema: {
    type: 'object',
    properties: {
      contentOrDiff: { type: 'string' },
      targetResource: { type: 'string' },
      requestedPermissions: { type: 'array', items: { type: 'string' } },
    },
    required: ['contentOrDiff'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      approved: { type: 'boolean' },
      riskScore: { type: 'number' },
      criticalIssuesCount: { type: 'number' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
            category: { type: 'string', enum: ['secret_leak', 'injection', 'excessive_permission'] },
            description: { type: 'string' },
            lineHint: { type: 'string' },
          },
          required: ['severity', 'category', 'description'],
        },
      },
      recommendations: { type: 'array', items: { type: 'string' } },
    },
    required: ['approved', 'riskScore', 'criticalIssuesCount', 'findings', 'recommendations'],
  },
  toolRequirements: [],
  permissions: [
    {
      action: 'query:security_audit',
      resource: 'workspace://security',
      scope: 'workspace',
      riskLevel: 'LOW',
      reason: 'Audit statis keamanan kode, kebocoran kredensial, dan pola izin.',
    },
  ],
  compatibility: {
    agentCoreVersion: '>=0.2.0',
    platforms: ['node', 'linux', 'windows'],
  },
  metadata: {
    category: 'security',
    author: 'personal-ai-os',
    risk: 'LOW',
  },
};

const SECRET_PATTERNS: Array<{ pattern: RegExp; description: string; severity: SecuritySeverity }> = [
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    description: 'Terdeteksi kunci privat kriptografis (Private Key).',
    severity: 'CRITICAL',
  },
  {
    pattern: /sk-[a-zA-Z0-9_-]{20,}/,
    description: 'Terdeteksi token API key (format sk-...).',
    severity: 'CRITICAL',
  },
  {
    pattern: /ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}/,
    description: 'Terdeteksi GitHub Personal Access Token.',
    severity: 'CRITICAL',
  },
  {
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    description: 'Terdeteksi token JWT bertanda tangan.',
    severity: 'HIGH',
  },
  {
    pattern: /(?:postgres|mysql|redis|mongodb):\/\/[a-zA-Z0-9_.-]+:[^@\s"']+@[a-zA-Z0-9_.-]+/,
    description: 'Terdeteksi URI koneksi basis data dengan kredensial tertanam.',
    severity: 'CRITICAL',
  },
  {
    pattern: /(?:password|secret|api_key|token)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
    description: 'Terdeteksi kata sandi atau rahasia hardcoded.',
    severity: 'HIGH',
  },
];

const INJECTION_PATTERNS: Array<{ pattern: RegExp; description: string; severity: SecuritySeverity }> = [
  {
    pattern: /(?:;|&&|\|\|)\s*(?:rm\s+-rf|del\s+\/f|shutdown|reboot|format\s+[a-z]:)/i,
    description: 'Terdeteksi perintah penghancuran sistem atau command chaining berbahaya.',
    severity: 'CRITICAL',
  },
  {
    pattern: /(?:\.\.\/|\.\.\\){2,}/,
    description: 'Terdeteksi pola path traversal (../ atau ..\\ bertingkat).',
    severity: 'HIGH',
  },
  {
    pattern: /UNION\s+SELECT|DROP\s+TABLE|--\s*$|'\s*OR\s*'1'\s*=\s*'1'/i,
    description: 'Terdeteksi pola injeksi SQL (SQL Injection).',
    severity: 'HIGH',
  },
  {
    pattern: /\beval\s*\(|\bFunction\s*\(|child_process\.exec\s*\(/,
    description: 'Terdeteksi evaluasi kode dinamis atau eksekusi subproses berisiko.',
    severity: 'HIGH',
  },
];

export const securityReviewHandler: SkillHandler<
  SecurityReviewInput,
  SecurityReviewOutput
> = async (input) => {
  const findings: SecurityFinding[] = [];
  const recommendations: string[] = [];
  const text = input.contentOrDiff;

  // 1. Scan Secrets
  for (const rule of SECRET_PATTERNS) {
    const match = rule.pattern.exec(text);
    if (match) {
      findings.push({
        severity: rule.severity,
        category: 'secret_leak',
        description: rule.description,
        lineHint: match[0].slice(0, 30) + '...',
      });
    }
  }

  // 2. Scan Injections
  for (const rule of INJECTION_PATTERNS) {
    const match = rule.pattern.exec(text);
    if (match) {
      findings.push({
        severity: rule.severity,
        category: 'injection',
        description: rule.description,
        lineHint: match[0].slice(0, 30),
      });
    }
  }

  // 3. Scan Excessive Permissions
  if (input.requestedPermissions && input.requestedPermissions.length > 0) {
    for (const perm of input.requestedPermissions) {
      if (perm === '*' || perm === '*:*' || perm.endsWith(':*')) {
        findings.push({
          severity: 'HIGH',
          category: 'excessive_permission',
          description: `Permintaan izin wildcard berlebih: '${perm}'.`,
        });
      }
      if (perm.toLowerCase().includes('critical') || perm.toLowerCase().includes('admin')) {
        findings.push({
          severity: 'MEDIUM',
          category: 'excessive_permission',
          description: `Permintaan izin berisiko tinggi '${perm}' memerlukan justifikasi eksplisit.`,
        });
      }
    }
  }

  // Calculate score and recommendations
  let riskScore = 0;
  let criticalIssuesCount = 0;

  for (const finding of findings) {
    switch (finding.severity) {
      case 'CRITICAL':
        riskScore += 40;
        criticalIssuesCount += 1;
        break;
      case 'HIGH':
        riskScore += 25;
        criticalIssuesCount += 1;
        break;
      case 'MEDIUM':
        riskScore += 10;
        break;
      case 'LOW':
        riskScore += 5;
        break;
    }
  }

  riskScore = Math.min(100, riskScore);
  const approved = criticalIssuesCount === 0 && riskScore < 50;

  if (findings.some((f) => f.category === 'secret_leak')) {
    recommendations.push(
      'Pindahkan seluruh secret/token ke variabel lingkungan (environment variables) di sisi server.',
    );
  }
  if (findings.some((f) => f.category === 'injection')) {
    recommendations.push(
      'Gunakan parameterized queries dan fungsi API aman alih-alih merangkai string perintah mentah.',
    );
  }
  if (findings.some((f) => f.category === 'excessive_permission')) {
    recommendations.push(
      'Batasi izin ke prinsip hak akses minimal (principle of least privilege) tanpa menggunakan wildcard.',
    );
  }

  if (approved && recommendations.length === 0) {
    recommendations.push('Perubahan lolos tinjauan keamanan statis tanpa temuan berisiko tinggi.');
  }

  return {
    approved,
    riskScore,
    criticalIssuesCount,
    findings,
    recommendations,
  };
};
