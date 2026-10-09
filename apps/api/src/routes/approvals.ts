import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.ts';
import { AuthError } from '../auth/service.ts';
import type { ApprovalRepository } from '../db/approval-repository.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { TaskRepository } from '../db/task-repository.ts';
import type { TaskEventBroadcaster } from '../services/event-broadcaster.ts';
import type { TaskQueue } from '../services/task-queue.ts';
import { createVersionedCheckpoint } from '@personal-ai-os/shared';

export interface ApprovalRouteDependencies {
  auth: AuthService;
  approvalRepo: ApprovalRepository;
  taskRepo?: TaskRepository | undefined;
  taskQueue?: TaskQueue | undefined;
  broadcaster?: TaskEventBroadcaster | undefined;
  auditRepo?: AuditRepository | undefined;
}

const extractUser = async (request: FastifyRequest, auth: AuthService) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('UNAUTHENTICATED', 'authentication required');
  }
  const token = authHeader.slice(7).trim();
  return auth.authenticate(token);
};

export const registerApprovalRoutes = (
  app: FastifyInstance,
  deps: ApprovalRouteDependencies,
): void => {
  // 1. List approvals inbox
  app.get<{
    Querystring: { status?: string | undefined; taskId?: string | undefined };
  }>('/v1/approvals', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const list = await deps.approvalRepo.listApprovals(user.id, {
      status: request.query.status,
      taskId: request.query.taskId,
    });
    return reply.send({ approvals: list });
  });

  // 2. Get approval detail
  app.get<{ Params: { approvalId: string } }>(
    '/v1/approvals/:approvalId',
    async (request, reply) => {
      const user = await extractUser(request, deps.auth);
      const approval = await deps.approvalRepo.getApproval(user.id, request.params.approvalId);
      if (!approval) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Approval not found',
            requestId: request.id,
          },
        });
      }
      return reply.send(approval);
    },
  );

  // 3. Approve
  app.post<{
    Params: { approvalId: string };
    Body: { reason?: string | undefined };
  }>('/v1/approvals/:approvalId/approve', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const body = (request.body as { reason?: string } | undefined) ?? {};

    const approval = await deps.approvalRepo.getApproval(user.id, request.params.approvalId);
    if (!approval) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Approval not found',
          requestId: request.id,
        },
      });
    }

    if (approval.status !== 'pending') {
      return reply.code(400).send({
        error: {
          code: 'APPROVAL_ALREADY_DECIDED',
          message: `Approval is already ${approval.status}`,
          requestId: request.id,
        },
      });
    }

    if (approval.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({
        error: {
          code: 'APPROVAL_EXPIRED',
          message: 'Approval has expired',
          requestId: request.id,
        },
      });
    }

    const updated = await deps.approvalRepo.decideApproval(
      user.id,
      approval.id,
      'approved',
      body.reason,
      user.id,
    );

    // Audit log
    if (deps.auditRepo) {
      await deps.auditRepo.log({
        userId: user.id,
        projectId: approval.projectId,
        action: 'approval:approved',
        resourceType: approval.scope,
        resourceId: approval.id,
        decision: 'allow',
        traceId: request.id,
        metadata: {
          targetAction: approval.action,
          targetResource: approval.resource,
          riskLevel: approval.riskLevel,
          reason: body.reason,
        },
      });
    }

    // If attached to a task in waiting_approval, advance and re-enqueue
    if (approval.taskId && deps.taskRepo) {
      const task = await deps.taskRepo.getTask(user.id, approval.taskId);
      if (task && task.status === 'waiting_approval') {
        const checkpoint = createVersionedCheckpoint({
          version: (task.checkpoint?.version ?? 0) + 1,
          stepIndex: 3,
          totalSteps: 4,
          lastExecutedAction: 'waiting_approval',
          actionType: 'approval',
          actionState: {
            ...task.checkpoint?.actionState,
            approved: true,
            approvalId: approval.id,
          },
          verified: true,
        });

        const updatedTask = await deps.taskRepo.updateTaskStatus(user.id, task.id, 'running', {
          checkpoint,
        });

        if (deps.broadcaster) {
          const evt = await deps.taskRepo.createTaskEvent(user.id, task.id, 'task.resumed', {
            approvalId: approval.id,
            action: 'approval_granted',
            approvedBy: user.id,
          });
          deps.broadcaster.publish(evt);
        }

        if (deps.taskQueue) {
          await deps.taskQueue.enqueue(updatedTask);
        }
      }
    }

    return reply.send({ approval: updated });
  });

  // 4. Deny
  app.post<{
    Params: { approvalId: string };
    Body: { reason?: string | undefined };
  }>('/v1/approvals/:approvalId/deny', async (request, reply) => {
    const user = await extractUser(request, deps.auth);
    const body = (request.body as { reason?: string } | undefined) ?? {};

    const approval = await deps.approvalRepo.getApproval(user.id, request.params.approvalId);
    if (!approval) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Approval not found',
          requestId: request.id,
        },
      });
    }

    if (approval.status !== 'pending') {
      return reply.code(400).send({
        error: {
          code: 'APPROVAL_ALREADY_DECIDED',
          message: `Approval is already ${approval.status}`,
          requestId: request.id,
        },
      });
    }

    if (approval.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({
        error: {
          code: 'APPROVAL_EXPIRED',
          message: 'Approval has expired',
          requestId: request.id,
        },
      });
    }

    const updated = await deps.approvalRepo.decideApproval(
      user.id,
      approval.id,
      'denied',
      body.reason,
      user.id,
    );

    // Audit log
    if (deps.auditRepo) {
      await deps.auditRepo.log({
        userId: user.id,
        projectId: approval.projectId,
        action: 'approval:denied',
        resourceType: approval.scope,
        resourceId: approval.id,
        decision: 'deny',
        traceId: request.id,
        metadata: {
          targetAction: approval.action,
          targetResource: approval.resource,
          riskLevel: approval.riskLevel,
          reason: body.reason,
        },
      });
    }

    // If attached to a task in waiting_approval, fail or cancel task
    if (approval.taskId && deps.taskRepo) {
      const task = await deps.taskRepo.getTask(user.id, approval.taskId);
      if (task && task.status === 'waiting_approval') {
        const reason = body.reason
          ? `Ditolak oleh pengguna: ${body.reason}`
          : 'Ditolak oleh pengguna';
        await deps.taskRepo.updateTaskStatus(user.id, task.id, 'failed', {
          error: reason,
        });

        if (deps.broadcaster) {
          const evt = await deps.taskRepo.createTaskEvent(user.id, task.id, 'task.failed', {
            approvalId: approval.id,
            reason,
            deniedBy: user.id,
          });
          deps.broadcaster.publish(evt);
        }
      }
    }

    return reply.send({ approval: updated });
  });
};
