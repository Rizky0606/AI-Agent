import {
  ArtifactAccessDeniedError,
  ArtifactManager,
  ArtifactNotFoundError,
  ArtifactQuotaExceededError,
  type ArtifactRetention,
  InvalidFilenameError,
  InvalidMimeTypeError,
} from '@personal-ai-os/tools';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';

interface AuthUser {
  id: string;
  email: string;
}

// The JSON route keeps Fastify's 1 MiB default; the streaming route accepts up to the
// manager's per-artifact cap (25 MiB by default) because the body is never buffered.
const STREAM_UPLOAD_BODY_LIMIT_BYTES = 25 * 1024 * 1024;

export function registerArtifactRoutes(
  app: FastifyInstance,
  options: { artifactManager: ArtifactManager; auth?: AuthService | undefined },
): void {
  const { artifactManager, auth } = options;

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

  // 1. Create / Upload Artifact
  app.post(
    '/v1/artifacts',
    async (
      req: FastifyRequest<{
        Body: {
          filename: string;
          mimeType: string;
          content: string;
          projectId?: string | null | undefined;
          taskId?: string | null | undefined;
          conversationId?: string | null | undefined;
          retention?: ArtifactRetention | undefined;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const { filename, mimeType, content, projectId, taskId, conversationId, retention } =
        req.body;

      if (!filename || !mimeType || content === undefined) {
        return reply
          .status(400)
          .send({ error: 'filename, mimeType, dan content harus disediakan.' });
      }

      try {
        const artifact = await artifactManager.createArtifact({
          ownerId: user.id,
          filename,
          mimeType,
          content,
          projectId,
          taskId,
          conversationId,
          retention,
        });
        return reply.status(201).send({ data: artifact });
      } catch (err: unknown) {
        if (
          err instanceof InvalidFilenameError ||
          err instanceof InvalidMimeTypeError ||
          err instanceof ArtifactQuotaExceededError
        ) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // 1b. Streaming Upload Artifact.
  // Contract: POST /v1/artifacts/stream?filename=<name>&mimeType=<type> with
  // Content-Type: application/octet-stream and the raw file bytes as the body.
  // Optional query: projectId, taskId, conversationId, retention.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) =>
    done(null, payload),
  );
  app.post(
    '/v1/artifacts/stream',
    { bodyLimit: STREAM_UPLOAD_BODY_LIMIT_BYTES },
    async (
      req: FastifyRequest<{
        Querystring: {
          filename?: string | undefined;
          mimeType?: string | undefined;
          projectId?: string | undefined;
          taskId?: string | undefined;
          conversationId?: string | undefined;
          retention?: ArtifactRetention | undefined;
        };
        Body: Readable;
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const { filename, mimeType, projectId, taskId, conversationId, retention } = req.query;

      if (!filename || !mimeType) {
        return reply
          .status(400)
          .send({ error: 'filename dan mimeType harus disediakan sebagai query parameter.' });
      }

      // Fastify skips body parsing for an empty request, so `req.body` can be undefined here.
      const body = req.body as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') {
        return reply.status(400).send({ error: 'Body biner artefak harus dikirim.' });
      }

      try {
        const artifact = await artifactManager.createArtifact({
          ownerId: user.id,
          filename,
          mimeType,
          content: body,
          projectId,
          taskId,
          conversationId,
          retention,
        });
        return reply.status(201).send({ data: artifact });
      } catch (err: unknown) {
        if (
          err instanceof InvalidFilenameError ||
          err instanceof InvalidMimeTypeError ||
          err instanceof ArtifactQuotaExceededError
        ) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // 2. List Artifacts for User
  app.get(
    '/v1/artifacts',
    async (
      req: FastifyRequest<{
        Querystring: { projectId?: string | undefined };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const list = await artifactManager.listArtifactsByUser(user.id, req.query.projectId ?? null);
      return reply.send({ data: list });
    },
  );

  // 3. Get Artifact Metadata
  app.get(
    '/v1/artifacts/:id',
    async (
      req: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      try {
        const artifact = await artifactManager.getArtifact(req.params.id, user.id);
        return reply.send({ data: artifact });
      } catch (err: unknown) {
        if (err instanceof ArtifactNotFoundError) {
          return reply.status(404).send({ error: err.message });
        }
        if (err instanceof ArtifactAccessDeniedError) {
          return reply.status(403).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // 4. Download / Stream Artifact Content
  app.get(
    '/v1/artifacts/:id/download',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Querystring: { token?: string | undefined };
      }>,
      reply: FastifyReply,
    ) => {
      const signedToken = req.query.token;
      let userId: string | undefined;

      if (!signedToken) {
        const user = await getUser(req);
        userId = user.id;
      }

      try {
        const artifact = await artifactManager.getArtifact(req.params.id, userId, signedToken);
        const stream = await artifactManager.getArtifactStream(req.params.id, userId, signedToken);

        return reply
          .header('Content-Type', artifact.mimeType)
          .header('Content-Disposition', `attachment; filename="${artifact.filename}"`)
          .send(stream);
      } catch (err: unknown) {
        if (err instanceof ArtifactNotFoundError) {
          return reply.status(404).send({ error: err.message });
        }
        if (err instanceof ArtifactAccessDeniedError) {
          return reply.status(403).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // 5. Generate Signed Temporary Download Token
  app.post(
    '/v1/artifacts/:id/signed-url',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body?: { expiresInMs?: number | undefined } | undefined;
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      const expiresInMs = req.body?.expiresInMs ?? 3600000;

      try {
        const signed = await artifactManager.createSignedAccessToken(req.params.id, user.id, expiresInMs);
        return reply.send({
          data: {
            token: signed.token,
            expiresAt: signed.expiresAt,
            downloadUrl: `/v1/artifacts/${req.params.id}/download?token=${signed.token}`,
          },
        });
      } catch (err: unknown) {
        if (err instanceof ArtifactNotFoundError) {
          return reply.status(404).send({ error: err.message });
        }
        if (err instanceof ArtifactAccessDeniedError) {
          return reply.status(403).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // 6. Delete Artifact
  app.delete(
    '/v1/artifacts/:id',
    async (
      req: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply,
    ) => {
      const user = await getUser(req);
      try {
        await artifactManager.deleteArtifact(req.params.id, user.id);
        return reply.send({ success: true });
      } catch (err: unknown) {
        if (err instanceof ArtifactNotFoundError) {
          return reply.status(404).send({ error: err.message });
        }
        if (err instanceof ArtifactAccessDeniedError) {
          return reply.status(403).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
