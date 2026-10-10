import { fileURLToPath } from 'node:url';
import { ApprovalRequiredError, PermissionDeniedError } from '@personal-ai-os/permissions';
import {
  codingQualityChecklistHandler,
  ManifestValidator,
  onTopicGuardHandler,
  researchQualityChecklistHandler,
  type SkillHandler,
  SkillDisabledError,
  SkillExecutor,
  SkillLoader,
} from '@personal-ai-os/agent-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { SkillRepository } from '../db/skill-repository.ts';

interface AuthUser {
  id: string;
  email: string;
}

export function registerSkillRoutes(
  app: FastifyInstance,
  options: {
    skillRepo: SkillRepository;
    auth?: AuthService | undefined;
    executor?: SkillExecutor | undefined;
    validator?: ManifestValidator | undefined;
    skillsDir?: string | undefined;
  },
): void {
  const { skillRepo, auth } = options;
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

      const skills = await skillRepo.listSkills(
        isEnabledFilter !== undefined ? { isEnabled: isEnabledFilter } : undefined,
      );
      return reply.code(200).send({ skills });
    },
  );

  // 2. Get Skill Detail
  app.get(
    '/v1/skills/:name',
    async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      await getUser(req);
      const skill = await skillRepo.getSkillByName(req.params.name);
      if (!skill) {
        return reply.code(404).send({ error: `Skill '${req.params.name}' tidak ditemukan.` });
      }

      const revisions = await skillRepo.getSkillRevisions(req.params.name);
      return reply.code(200).send({ skill, revisions });
    },
  );

  // 3. Enable Skill
  app.post(
    '/v1/skills/:name/enable',
    async (req: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      await getUser(req);
      try {
        const skill = await skillRepo.enableSkill(req.params.name);
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
      await getUser(req);
      try {
        const skill = await skillRepo.disableSkill(req.params.name);
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
        return reply.code(200).send({ result });
      } catch (err) {
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
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: `Eksekusi skill gagal: ${msg}` });
      }
    },
  );
}
