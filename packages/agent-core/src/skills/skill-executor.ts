import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import {
  type SkillExecutionContext,
  type SkillHandler,
  type SkillManifest,
  type SkillRecord,
  SkillDisabledError,
} from './types.ts';

export class SkillExecutor {
  private readonly guard: SecuredCapabilityGuard;

  constructor(guard?: SecuredCapabilityGuard) {
    this.guard = guard ?? new SecuredCapabilityGuard(new PermissionEngine());
  }

  async executeSkill<TInput = Record<string, unknown>, TOutput = Record<string, unknown>>(
    skill: SkillRecord | { manifest: SkillManifest; isEnabled?: boolean },
    handler: SkillHandler<TInput, TOutput>,
    input: TInput,
    context: SkillExecutionContext,
  ): Promise<TOutput> {
    // 1. Check if skill is enabled
    if (skill.isEnabled === false) {
      throw new SkillDisabledError(skill.manifest.name);
    }

    const manifest = skill.manifest;

    // 2. ENFORCE PERMISSION ENGINE GATE FOR ALL DECLARED PERMISSIONS
    // Rule: "Skill TIDAK otomatis tepercaya dan tidak boleh melewati Permission Engine."
    for (const perm of manifest.permissions) {
      await this.guard.executeProtected(
        {
          actor: { id: context.userId, role: 'user' },
          action: perm.action,
          resource: perm.resource,
          scope: perm.scope,
          context: {
            skillName: manifest.name,
            skillVersion: manifest.version,
            taskId: context.taskId,
            projectId: context.projectId,
          },
        },
        async () => {
          // Permission verified for this capability
          return true;
        },
        { approvalId: context.approvalId },
      );
    }

    // 3. Execute the skill handler with verified context
    return await handler(input, context);
  }
}
