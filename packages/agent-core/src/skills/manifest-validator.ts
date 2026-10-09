import {
  type SkillManifest,
  SkillIncompatibleError,
  SkillPermissionViolationError,
  SkillValidationError,
} from './types.ts';

export const CURRENT_AGENT_CORE_VERSION = '0.2.0';

// Forbidden actions that skills are NEVER allowed to declare or request (Deny-by-default system boundaries)
const FORBIDDEN_SKILL_ACTIONS = [
  /^system:(shutdown|reboot|exec_elevated|rmdir_root)/i,
  /^auth:(revoke_all|change_master_key)/i,
  /^(db|database):(drop|truncate|delete_database)/i,
  /^security:(bypass|disable_guard)/i,
];

export class ManifestValidator {
  private readonly currentVersion: string;
  private readonly currentPlatform: string;

  constructor(options?: {
    currentVersion?: string | undefined;
    currentPlatform?: string | undefined;
  }) {
    this.currentVersion = options?.currentVersion ?? CURRENT_AGENT_CORE_VERSION;
    this.currentPlatform =
      options?.currentPlatform ?? (typeof process !== 'undefined' ? process.platform : 'node');
  }

  validate(manifest: unknown): SkillManifest {
    const errors: string[] = [];

    if (!manifest || typeof manifest !== 'object') {
      throw new SkillValidationError('Manifest harus berupa object JSON valid.');
    }

    const m = manifest as Record<string, unknown>;

    // 1. Name validation
    if (typeof m['name'] !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m['name'])) {
      errors.push(
        "Field 'name' harus berupa string kebab-case huruf kecil (misal: 'on-topic-guard').",
      );
    }

    // 2. Version validation (SemVer)
    if (
      typeof m['version'] !== 'string' ||
      !/^\d+\.\d+\.\d+(-[a-zA-Z0-9_.-]+)?$/.test(m['version'])
    ) {
      errors.push("Field 'version' harus berupa format semver valid (misal: '1.0.0').");
    }

    // 3. Description validation
    if (typeof m['description'] !== 'string' || m['description'].trim().length < 5) {
      errors.push("Field 'description' harus berupa string penjelasan minimal 5 karakter.");
    }

    // 4. Schema validation
    if (!m['inputSchema'] || typeof m['inputSchema'] !== 'object') {
      errors.push("Field 'inputSchema' harus berupa object schema valid.");
    }
    if (!m['outputSchema'] || typeof m['outputSchema'] !== 'object') {
      errors.push("Field 'outputSchema' harus berupa object schema valid.");
    }

    // 5. Tool Requirements
    if (!Array.isArray(m['toolRequirements'])) {
      errors.push("Field 'toolRequirements' harus berupa array string.");
    }

    // 6. Permissions validation & boundary check
    if (!Array.isArray(m['permissions'])) {
      errors.push("Field 'permissions' harus berupa array permission.");
    } else {
      for (const p of m['permissions']) {
        if (!p || typeof p !== 'object') {
          errors.push('Setiap entri permission harus berupa object.');
          continue;
        }

        const perm = p as Record<string, unknown>;
        if (typeof perm['action'] !== 'string' || !perm['action'].trim()) {
          errors.push('Setiap permission wajib memiliki field action yang valid.');
          continue;
        }

        const actionStr = perm['action'];

        // BOUNDARY CHECK: Deny forbidden system actions
        for (const pattern of FORBIDDEN_SKILL_ACTIONS) {
          if (pattern.test(actionStr)) {
            throw new SkillPermissionViolationError(
              `Skill '${String(m['name'])}' ditolak: meminta permission di luar batas keamanan yang diizinkan (${actionStr}). Tindakan destruktif/sistem dilarang keras untuk skill.`,
              actionStr,
            );
          }
        }

        const validRisks = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        if (typeof perm['riskLevel'] !== 'string' || !validRisks.includes(perm['riskLevel'])) {
          errors.push(
            `riskLevel pada permission '${actionStr}' harus salah satu dari: ${validRisks.join(', ')}.`,
          );
        }
      }
    }

    // 7. Compatibility validation
    if (!m['compatibility'] || typeof m['compatibility'] !== 'object') {
      errors.push("Field 'compatibility' wajib didefinisikan.");
    }

    if (errors.length > 0) {
      throw new SkillValidationError(
        `Manifest skill '${String(m['name'] ?? 'unknown')}' tidak valid: ${errors.join('; ')}`,
        errors,
      );
    }

    const validated = manifest as SkillManifest;

    // 8. Runtime Compatibility Check
    this.checkCompatibility(validated);

    return validated;
  }

  private checkCompatibility(manifest: SkillManifest): void {
    const comp = manifest.compatibility;

    // Check agentCoreVersion constraint if provided
    if (comp.agentCoreVersion) {
      const isCompat = this.isVersionCompatible(this.currentVersion, comp.agentCoreVersion);
      if (!isCompat) {
        throw new SkillIncompatibleError(
          `Skill '${manifest.name}' tidak kompatibel: membutuhkan agentCoreVersion '${comp.agentCoreVersion}', namun versi runtime saat ini adalah '${this.currentVersion}'.`,
        );
      }
    }

    // Check platform constraint if provided
    if (comp.platforms && comp.platforms.length > 0) {
      const isPlatformSupported =
        comp.platforms.includes(this.currentPlatform) ||
        comp.platforms.includes('node') ||
        (this.currentPlatform === 'win32' && comp.platforms.includes('windows'));

      if (!isPlatformSupported) {
        throw new SkillIncompatibleError(
          `Skill '${manifest.name}' tidak kompatibel dengan platform host '${this.currentPlatform}'. Platform yang didukung: ${comp.platforms.join(', ')}.`,
        );
      }
    }
  }

  private isVersionCompatible(current: string, requiredRange: string): boolean {
    const cleaned = requiredRange.trim();
    if (cleaned === '*' || cleaned === 'latest') return true;

    if (cleaned.startsWith('>=')) {
      const minReq = cleaned.slice(2).trim();
      return this.compareSemver(current, minReq) >= 0;
    }

    if (cleaned.startsWith('^')) {
      const baseReq = cleaned.slice(1).trim();
      const [curMajor, curMinor] = current.split('.').map(Number);
      const [baseMajor, baseMinor] = baseReq.split('.').map(Number);
      return curMajor === baseMajor && (curMinor ?? 0) >= (baseMinor ?? 0);
    }

    return current === cleaned;
  }

  private compareSemver(v1: string, v2: string): number {
    const p1 = v1.split('-')[0]!.split('.').map(Number);
    const p2 = v2.split('-')[0]!.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const num1 = p1[i] ?? 0;
      const num2 = p2[i] ?? 0;
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    return 0;
  }
}
