import { ManifestValidator, type SkillManifest } from '@personal-ai-os/agent-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { SkillProposalRepository } from '../db/skill-proposal-repository.ts';
import type { SkillRepository } from '../db/skill-repository.ts';
import { sanitizeSensitiveJson, sanitizeSensitiveText } from '../services/sensitive-data-filter.ts';

interface AuthUser {
  id: string;
  email: string;
}

export interface SkillProposalsRoutesOptions {
  auth: AuthService;
  proposalRepo: SkillProposalRepository;
  skillRepo: SkillRepository;
  auditRepo?: AuditRepository | undefined;
  validator?: ManifestValidator | undefined;
}

export const registerSkillProposalsRoutes = async (
  fastify: FastifyInstance,
  options: SkillProposalsRoutesOptions,
): Promise<void> => {
  const { auth, proposalRepo, skillRepo, validator = new ManifestValidator() } = options;

  const authenticate = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthUser | undefined> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      void reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Format header authorization Bearer <token> diperlukan',
        },
      });
      return undefined;
    }
    const token = authHeader.slice(7).trim();
    try {
      const authUser = await auth.authenticate(token);
      return { id: authUser.id, email: authUser.email };
    } catch {
      void reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Token akses tidak valid atau telah kedaluwarsa' },
      });
      return undefined;
    }
  };

  // 1. List Skill Proposals
  fastify.get(
    '/v1/skills/proposals',
    async (
      request: FastifyRequest<{
        Querystring: { status?: 'pending' | 'approved' | 'rejected' };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const proposals = await proposalRepo.listProposals(user.id, {
        status: request.query.status,
      });

      return reply.code(200).send({ proposals });
    },
  );

  // 2. Create Skill Proposal (usulan baru atau perbaikan skill)
  fastify.post(
    '/v1/skills/proposals',
    async (
      request: FastifyRequest<{
        Body: {
          skillName: string;
          title: string;
          description: string;
          proposedManifest: SkillManifest;
          promptInstructions?: string;
          changeType?: 'new_skill' | 'improvement';
          targetSkillName?: string;
          taskId?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const body = request.body;
      if (!body.skillName || !body.title || !body.description || !body.proposedManifest) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Field skillName, title, description, dan proposedManifest wajib diisi',
          },
        });
      }

      // 1. Sanitasi data sensitif pada manifest dan prompt instructions
      const sanitizedManifestRes = sanitizeSensitiveJson(body.proposedManifest);
      const sanitizedPromptRes = sanitizeSensitiveText(body.promptInstructions ?? '');

      // 2. Validasi manifest struktur & permission
      try {
        validator.validate(sanitizedManifestRes.cleanData);
      } catch (valErr: unknown) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_MANIFEST',
            message: `Manifest usulan skill tidak valid: ${valErr instanceof Error ? valErr.message : String(valErr)}`,
          },
        });
      }

      // 3. Jika perbaikan skill (improvement), buat diff terhadap skill lama
      let diffText: string | null = null;
      const changeType = body.changeType ?? 'new_skill';
      if (changeType === 'improvement' && body.targetSkillName) {
        const existingSkill = await skillRepo.getSkillByName(body.targetSkillName);
        if (existingSkill) {
          const oldJson = JSON.stringify(existingSkill.manifest, null, 2);
          const newJson = JSON.stringify(sanitizedManifestRes.cleanData, null, 2);
          diffText = `--- a/${existingSkill.name}.json\n+++ b/${existingSkill.name}.json\n${generateSimpleDiff(oldJson, newJson)}`;
        }
      }

      const proposal = await proposalRepo.createProposal({
        userId: user.id,
        taskId: body.taskId ?? null,
        skillName: body.skillName.trim(),
        title: body.title.trim(),
        description: body.description.trim(),
        proposedManifest: sanitizedManifestRes.cleanData,
        promptInstructions: sanitizedPromptRes.cleanText || null,
        changeType,
        targetSkillName: body.targetSkillName ?? null,
        diff: diffText,
      });

      return reply.code(201).send({ proposal });
    },
  );

  // 3. Approve Skill Proposal (terapkan skill dalam keadaan NONAKTIF)
  fastify.post(
    '/v1/skills/proposals/:id/approve',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      try {
        const result = await proposalRepo.approveProposal(request.params.id, user.id);
        // Terapkan ke skillRepo dan pastikan selalu dalam keadaan NONAKTIF
        await skillRepo.upsertSkill(result.proposal.proposedManifest);
        await skillRepo.disableSkill(result.createdSkillName);

        return reply.code(200).send({
          success: true,
          proposal: result.proposal,
          createdSkillName: result.createdSkillName,
          statusNote: 'Skill berhasil dibuat dalam keadaan NONAKTIF. Anda dapat mengaktifkannya di pengaturan skill.',
        });
      } catch (err: unknown) {
        return reply.code(400).send({
          error: {
            code: 'APPROVAL_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },
  );

  // 4. Reject Skill Proposal
  fastify.post(
    '/v1/skills/proposals/:id/reject',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { reason?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await authenticate(request, reply);
      if (!user) return;

      const reason = request.body?.reason || 'Ditolak oleh pengguna tanpa alasan spesifik.';

      try {
        const proposal = await proposalRepo.rejectProposal(request.params.id, user.id, reason);
        return reply.code(200).send({
          success: true,
          proposal,
        });
      } catch (err: unknown) {
        return reply.code(400).send({
          error: {
            code: 'REJECTION_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },
  );
};

function generateSimpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diff: string[] = [];

  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      if (o !== undefined) diff.push(` ${o}`);
    } else {
      if (o !== undefined) diff.push(`-${o}`);
      if (n !== undefined) diff.push(`+${n}`);
    }
  }

  return diff.join('\n');
}
