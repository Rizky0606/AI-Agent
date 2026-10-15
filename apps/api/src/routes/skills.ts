import type { ToolRegistry } from '@personal-ai-os/tools';
import { fileURLToPath } from 'node:url';
import { ApprovalRequiredError, PermissionDeniedError } from '@personal-ai-os/permissions';
import {
  codingQualityChecklistHandler,
  ManifestValidator,
  onTopicGuardHandler,
  planBeforeActHandler,
  researchQualityChecklistHandler,
  securityReviewHandler,
  type SkillHandler,
  type SkillRecord,
  SkillDisabledError,
  SkillExecutor,
  SkillLoader,
  verifyWithEvidenceHandler,
} from '@personal-ai-os/agent-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { SkillRepository } from '../db/skill-repository.ts';
import type { AuditRepository } from '../db/audit-repository.ts';

interface AuthUser {
  id: string;
  email: string;
}

export function registerSkillRoutes(
  app: FastifyInstance,
  options: {
    skillRepo: SkillRepository;
    auth?: AuthService | undefined;
    auditRepo?: AuditRepository | undefined;
    executor?: SkillExecutor | undefined;
    validator?: ManifestValidator | undefined;
    skillsDir?: string | undefined;
    toolRegistry?: ToolRegistry | undefined;
  },
): void {
  const { skillRepo, auth, auditRepo } = options;
  const executor = options.executor ?? new SkillExecutor();
  const validator = options.validator ?? new ManifestValidator();
  const loader = new SkillLoader(validator);
  const defaultSkillsDir =
    process.env['SKILLS_DIR'] ?? fileURLToPath(new URL('../../../../skills', import.meta.url));
  const skillsDir = options.skillsDir ?? defaultSkillsDir;

  // In-memory handler registry for builtin skills
  const builtinHandlers = new Map<string, SkillHandler<never, never>>();
  builtinHandlers.set('on-topic-guard', onTopicGuardHandler as never);
  builtinHandlers.set('coding-quality-checklist', codingQualityChecklistHandler as never);
  builtinHandlers.set('research-quality-checklist', researchQualityChecklistHandler as never);
  builtinHandlers.set('plan-before-act', planBeforeActHandler as never);
  builtinHandlers.set('verify-with-evidence', verifyWithEvidenceHandler as never);
  builtinHandlers.set('security-review', securityReviewHandler as never);

  const getUser = async (req: FastifyRequest): Promise<AuthUser> => {
    if (auth) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        throw new AuthError('UNAUTHENTICATED', 'authentication required');
      }
      const token = authHeader.slice(7).trim();
      return auth.authenticate(token);
    }
    return (
      (req as unknown as { user?: AuthUser }).user ?? {
        id: 'default-user',
        email: 'user@personal-ai-os.local',
      }
    );
  };

  const HERMES_READONLY_SKILLS: SkillRecord[] = [
    {
      id: 'hermes-skill-telegram',
      name: 'hermes_telegram_messenger',
      version: '0.20.5',
      isEnabled: true,
      source: 'hermes',
      isReadOnly: true,
      manifest: {
        name: 'hermes_telegram_messenger',
        version: '0.20.5',
        description: 'Kirim notifikasi dan interaksi pesan melalui bot Telegram terhubung',
        category: 'communication',
        toolRequirements: ['telegram:send'],
        permissions: ['tool:execute'],
        compatibility: { platforms: ['backend'] },
        metadata: { source: 'hermes', readOnly: true, risk: 'LOW' },
      },
      createdAt: new Date('2026-10-15T00:00:00.000Z'),
      updatedAt: new Date('2026-10-15T00:00:00.000Z'),
    } as unknown as SkillRecord,
    {
      id: 'hermes-skill-search',
      name: 'hermes_web_search',
      version: '0.20.5',
      isEnabled: true,
      source: 'hermes',
      isReadOnly: true,
      manifest: {
        name: 'hermes_web_search',
        version: '0.20.5',
        description: 'Pencarian web publik dan perangkuman informasi berbasis Hermes',
        category: 'research',
        toolRequirements: ['web:search'],
        permissions: ['tool:execute'],
        compatibility: { platforms: ['backend'] },
        metadata: { source: 'hermes', readOnly: true, risk: 'LOW' },
      },
      createdAt: new Date('2026-10-15T00:00:00.000Z'),
      updatedAt: new Date('2026-10-15T00:00:00.000Z'),
    } as unknown as SkillRecord,
    {
      id: 'hermes-skill-browser',
      name: 'hermes_browser_automation',
      version: '0.20.5',
      isEnabled: true,
      source: 'hermes',
      isReadOnly: true,
      manifest: {
        name: 'hermes_browser_automation',
        version: '0.20.5',
        description: 'Otomasi navigasi browser dan ekstraksi konten halaman',
        category: 'automation',
        toolRequirements: ['browser:navigate'],
        permissions: ['tool:execute'],
        compatibility: { platforms: ['backend'] },
        metadata: { source: 'hermes', readOnly: true, risk: 'MEDIUM' },
      },
      createdAt: new Date('2026-10-15T00:00:00.000Z'),
      updatedAt: new Date('2026-10-15T00:00:00.000Z'),
    } as unknown as SkillRecord,
    {
      id: 'hermes-skill-memory',
      name: 'hermes_memory_recall',
      version: '0.20.5',
      isEnabled: true,
      source: 'hermes',
      isReadOnly: true,
      manifest: {
        name: 'hermes_memory_recall',
        version: '0.20.5',
        description: 'Pencarian memori dan preferensi interaksi pengguna Hermes',
        category: 'memory',
        toolRequirements: ['memory:read'],
        permissions: ['tool:execute'],
        compatibility: { platforms: ['backend'] },
        metadata: { source: 'hermes', readOnly: true, risk: 'LOW' },
      },
      createdAt: new Date('2026-10-15T00:00:00.000Z'),
      updatedAt: new Date('2026-10-15T00:00:00.000Z'),
    } as unknown as SkillRecord,
    {
      id: 'hermes-skill-runner',
      name: 'hermes_script_runner',
      version: '0.20.5',
      isEnabled: true,
      source: 'hermes',
      isReadOnly: true,
      manifest: {
        name: 'hermes_script_runner',
        version: '0.20.5',
        description: 'Eksekusi skrip otomasi Python/Bash dalam lingkungan terkontrol',
        category: 'tools',
        toolRequirements: ['terminal:execute'],
        permissions: ['tool:execute'],
        compatibility: { platforms: ['backend'] },
        metadata: { source: 'hermes', readOnly: true, risk: 'MEDIUM' },
      },
      createdAt: new Date('2026-10-15T00:00:00.000Z'),
      updatedAt: new Date('2026-10-15T00:00:00.000Z'),
    } as unknown as SkillRecord,
  ];

  // 1. List Skills
  app.get(
    '/v1/skills',
    async (
      req: FastifyRequest<{ Querystring: { isEnabled?: string | undefined } }>,
      reply: FastifyReply,
    ) => {
      await getUser(req);
      const isEnabledFilter =
        req.query.isEnabled !== undefined ? req.query.isEnabled === 'true' : undefined;

      const dbSkills = await skillRepo.listSkills(
        isEnabledFilter !== undefined ? { isEnabled: isEnabledFilter } : undefined,
      );
      const allSkills = isEnabledFilter === false ? dbSkills : [...dbSkills, ...HERMES_READONLY_SKILLS];
      return reply.code(200).send({ skills: allSkills });
    },
  );
  // Catalog exposes manifest policy fields without creating a parallel tool registry.
  app.get('/v1/catalog', async (req: FastifyRequest, reply: FastifyReply) => {
    await getUser(req);
    const skills = await skillRepo.listSkills();
    const tools = (options.toolRegistry?.listTools() ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      capability: tool.capability,
      resourceScope: tool.resourceScope,
      riskLevel: tool.riskLevel,
      action: tool.action,
      timeoutMs: tool.timeoutMs,
      supportsCancellation: tool.supportsCancellation,
      outputLimitBytes: tool.outputLimitBytes,
      platform: 'backend',
      approvalRequired: tool.riskLevel === 'HIGH' || tool.riskLevel === 'CRITICAL',
    }));
    return reply.code(200).send({
      skills: skills.map((skill) => ({
        ...skill,
        risk: skill.manifest.metadata?.['risk'] ?? 'unknown',
        capabilities: skill.manifest.toolRequirements,
        approvalRequired: skill.manifest.permissions.length > 0,
        platforms: skill.manifest.compatibility.platforms,
      })),
      tools,
    });
  });

  // 2. Get Skill Detail
  app.get(
    '/v1/skills/:name',
    async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      await getUser(req);
      const skill = (await skillRepo.getSkillByName(req.params.name)) ??
        HERMES_READONLY_SKILLS.find((s) => s.name === req.params.name);
      if (!skill) {
        return reply.code(404).send({ error: `Skill '${req.params.name}' tidak ditemukan.` });
      }

      const revisions = skill.isReadOnly ? [] : await skillRepo.getSkillRevisions(req.params.name);
      return reply.code(200).send({ skill, revisions });
    },
  );

  // 2b. Get Skill Raw Manifest
  app.get(
    '/v1/skills/:name/manifest',
    async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      await getUser(req);
      const skill = (await skillRepo.getSkillByName(req.params.name)) ??
        HERMES_READONLY_SKILLS.find((s) => s.name === req.params.name);
      if (!skill) {
        return reply.code(404).send({ error: `Skill '${req.params.name}' tidak ditemukan.` });
      }
      return reply.code(200).send({ manifest: skill.manifest });
    },
  );

  // 2c. Get Project Skills List (with project-level enablement overrides)
  app.get(
    '/v1/projects/:projectId/skills',
    async (req: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
      await getUser(req);
      const dbSkills = await skillRepo.listSkills();
      const allSkills = [...dbSkills, ...HERMES_READONLY_SKILLS];
      const projectOverrides = await skillRepo.getProjectSkills(req.params.projectId);

      const skillsWithProjectStatus = allSkills.map((s) => ({
        ...s,
        isEnabled: projectOverrides[s.name] ?? s.isEnabled,
        isProjectOverride: projectOverrides[s.name] !== undefined,
      }));

      return reply.code(200).send({ skills: skillsWithProjectStatus });
    },
  );

  // 2d. Toggle Skill for a specific Project
  app.post(
    '/v1/projects/:projectId/skills/:name/toggle',
    async (
      req: FastifyRequest<{
        Params: { projectId: string; name: string };
        Body: { isEnabled: boolean };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      if (HERMES_READONLY_SKILLS.some((s) => s.name === req.params.name)) {
        return reply.code(403).send({ error: `Skill '${req.params.name}' berasal dari Hermes dan berstatus read-only.` });
      }

      const isEnabled = Boolean(req.body?.isEnabled);
      await skillRepo.setProjectSkill(req.params.projectId, req.params.name, isEnabled);

      await auditRepo?.log({
        userId: user.id,
        projectId: req.params.projectId,
        action: 'skill:toggle_project',
        resourceType: 'project_skill',
        resourceId: req.params.name,
        decision: 'allow',
        metadata: { isEnabled },
      });

      return reply.code(200).send({
        projectId: req.params.projectId,
        skillName: req.params.name,
        isEnabled,
      });
    },
  );

  // 3. Enable Skill
  app.post(
    '/v1/skills/:name/enable',
    async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const user = await getUser(req);
      if (HERMES_READONLY_SKILLS.some((s) => s.name === req.params.name)) {
        return reply.code(403).send({ error: `Skill '${req.params.name}' berasal dari Hermes dan berstatus read-only.` });
      }
      try {
        const skill = await skillRepo.enableSkill(req.params.name);
        await auditRepo?.log({
          userId: user.id,
          action: 'skill:enable',
          resourceType: 'skill',
          resourceId: req.params.name,
          decision: 'allow',
        });
        return reply.code(200).send({ skill });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(404).send({ error: msg });
      }
    },
  );

  // 4. Disable Skill
  app.post(
    '/v1/skills/:name/disable',
    async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const user = await getUser(req);
      if (HERMES_READONLY_SKILLS.some((s) => s.name === req.params.name)) {
        return reply.code(403).send({ error: `Skill '${req.params.name}' berasal dari Hermes dan berstatus read-only.` });
      }
      try {
        const skill = await skillRepo.disableSkill(req.params.name);
        await auditRepo?.log({
          userId: user.id,
          action: 'skill:disable',
          resourceType: 'skill',
          resourceId: req.params.name,
          decision: 'allow',
        });
        return reply.code(200).send({ skill });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(404).send({ error: msg });
      }
    },
  );

  // 5. Rollback Skill Version
  app.post(
    '/v1/skills/:name/rollback',
    async (
      req: FastifyRequest<{
        Params: { name: string };
        Body: { targetVersion?: string | undefined };
      }>,
      reply: FastifyReply,
    ) => {
      await getUser(req);
      try {
        const rolledBack = await skillRepo.rollbackSkill(req.params.name, req.body?.targetVersion);
        return reply.code(200).send({
          skill: rolledBack,
          message: `Skill '${req.params.name}' berhasil di-rollback ke versi '${rolledBack.version}'.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: msg });
      }
    },
  );

  // 6. Sync / Reload Skills from disk directory
  app.post('/v1/skills/sync', async (req: FastifyRequest, reply: FastifyReply) => {
    await getUser(req);
    try {
      const diskSkills = await loader.loadFromDirectory(skillsDir);
      const syncedSkills = [];

      for (const item of diskSkills) {
        const saved = await skillRepo.upsertSkill(item.manifest);
        syncedSkills.push(saved);
      }

      return reply.code(200).send({
        syncedCount: syncedSkills.length,
        skills: syncedSkills,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: `Gagal sinkronisasi skills: ${msg}` });
    }
  });

  // 7. Execute Skill (Permission Engine Gated)
  app.post(
    '/v1/skills/:name/execute',
    async (
      req: FastifyRequest<{
        Params: { name: string };
        Body: {
          input: Record<string, unknown>;
          approvalId?: string | undefined;
          taskId?: string | undefined;
          projectId?: string | undefined;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const skill = await skillRepo.getSkillByName(req.params.name);

      if (!skill) {
        return reply.code(404).send({ error: `Skill '${req.params.name}' tidak ditemukan.` });
      }

      const handler = builtinHandlers.get(req.params.name);
      if (!handler) {
        return reply.code(501).send({
          error: `Handler eksekusi untuk skill '${req.params.name}' belum didukung secara live.`,
        });
      }

      try {
        const result = await executor.executeSkill(skill, handler, req.body.input as never, {
          userId: user.id,
          taskId: req.body.taskId,
          projectId: req.body.projectId,
          approvalId: req.body.approvalId,
        });

        const isPolicyBlocked = Boolean(
          result &&
            typeof result === 'object' &&
            (('allowed' in (result as Record<string, unknown>) && (result as { allowed: boolean }).allowed === false) ||
             ('verified' in (result as Record<string, unknown>) && (result as { verified: boolean }).verified === false) ||
             ('passed' in (result as Record<string, unknown>) && (result as { passed: boolean }).passed === false) ||
             ('isOnTopic' in (result as Record<string, unknown>) && (result as { isOnTopic: boolean }).isOnTopic === false))
        );

        if (isPolicyBlocked) {
          const reason =
            (result as Record<string, unknown>).reason ??
            (result as Record<string, unknown>).message ??
            'Kebijakan skill menolak aksi atau verifikasi gagal.';
          await skillRepo.recordSkillUsage(req.params.name, 'failure', String(reason));
          await auditRepo?.log({
            userId: user.id,
            projectId: req.body.projectId,
            action: 'skill:execute',
            resourceType: 'skill',
            resourceId: req.params.name,
            decision: 'deny',
            metadata: { outcome: 'failure', reason, taskId: req.body.taskId },
          });
        } else {
          await skillRepo.recordSkillUsage(req.params.name, 'success');
          await auditRepo?.log({
            userId: user.id,
            projectId: req.body.projectId,
            action: 'skill:execute',
            resourceType: 'skill',
            resourceId: req.params.name,
            decision: 'allow',
            metadata: { outcome: 'success', taskId: req.body.taskId },
          });
        }

        return reply.code(200).send({ result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await skillRepo.recordSkillUsage(req.params.name, 'failure', msg);
        await auditRepo?.log({
          userId: user.id,
          projectId: req.body.projectId,
          action: 'skill:execute',
          resourceType: 'skill',
          resourceId: req.params.name,
          decision: 'deny',
          metadata: { outcome: 'failure', error: msg, taskId: req.body.taskId },
        });

        if (err instanceof ApprovalRequiredError) {
          return reply.code(403).send({
            error: err.message,
            requiresApproval: true,
            riskLevel: err.riskLevel,
            requiredApproval: err.requiredApproval,
          });
        }
        if (err instanceof PermissionDeniedError) {
          return reply.code(403).send({
            error: err.message,
            riskLevel: err.riskLevel,
          });
        }
        if (err instanceof SkillDisabledError) {
          return reply.code(400).send({ error: err.message });
        }
        return reply.code(500).send({ error: `Eksekusi skill gagal: ${msg}` });
      }
    },
  );
}
