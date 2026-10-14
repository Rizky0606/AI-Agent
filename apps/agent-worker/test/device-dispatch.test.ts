import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TaskStateMachine,
  type TaskCheckpoint,
  type TaskEventEnvelope,
  type TaskRecord,
  type TaskRepository,
  type TaskStatus,
} from '@personal-ai-os/shared';
import { PermissionEngine, SecuredCapabilityGuard } from '@personal-ai-os/permissions';
import type { DeviceCommandResult } from '@personal-ai-os/api/services';
import { TaskExecutor } from '../src/index.ts';
import type { DeviceDispatcher } from '../src/device-dispatcher.ts';

class RecordingTaskRepo implements TaskRepository {
  readonly events: TaskEventEnvelope[] = [];
  private current: TaskRecord;

  constructor(payload: Record<string, unknown>, kind = 'windows_command') {
    this.current = {
      id: 'task-device-1',
      userId: 'user-device',
      projectId: 'proj-device',
      status: 'queued',
      kind,
      payload,
      priority: 0,
      attempt: 0,
      maxAttempts: 3,
      progress: 0,
      idempotencyKey: null,
      error: null,
      checkpoint: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getTask(): Promise<TaskRecord | null> {
    return { ...this.current };
  }

  /** Mirrors what the approvals route does when it re-enqueues a task: step 3, approved: true. */
  markApproved(approvalId: string): void {
    this.current = {
      ...this.current,
      status: 'running',
      checkpoint: {
        version: 3,
        stepIndex: 3,
        totalSteps: 4,
        lastExecutedAction: 'waiting_approval',
        actionType: 'approval',
        actionState: { approved: true, approvalId },
        verified: true,
      } as TaskCheckpoint,
    };
  }

  async updateTaskStatus(
    _userId: string,
    _taskId: string,
    status: TaskStatus,
    updates?: { error?: string | null | undefined; checkpoint?: TaskCheckpoint | undefined },
  ): Promise<TaskRecord> {
    // Mirrors SqlTaskRepository: a status the state machine forbids must throw here too, otherwise
    // this fake would hide production failures.
    TaskStateMachine.assertTransition(this.current.status, status);
    this.current = {
      ...this.current,
      status,
      error: updates?.error ?? this.current.error,
      checkpoint: updates?.checkpoint ?? this.current.checkpoint,
    };
    return { ...this.current };
  }

  async updateTaskProgress(
    _userId: string,
    _taskId: string,
    progress: number,
    checkpoint?: TaskCheckpoint | undefined,
  ): Promise<TaskRecord> {
    this.current = { ...this.current, progress, checkpoint: checkpoint ?? this.current.checkpoint };
    return { ...this.current };
  }

  async createTaskEvent(
    _userId: string,
    _taskId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<TaskEventEnvelope> {
    const event = {
      id: `evt-${this.events.length + 1}`,
      eventId: `evt-${this.events.length + 1}`,
      taskId: this.current.id,
      userId: this.current.userId,
      eventType,
      payload,
      createdAt: new Date().toISOString(),
    } as TaskEventEnvelope;
    this.events.push(event);
    return event;
  }
}

const hostnameOutput: DeviceCommandResult = {
  commandId: 'cmd-1',
  success: true,
  result: { exitCode: 0, stdout: 'DESKTOP-ABC\r\n', stderr: '', truncated: false, durationMs: 8 },
};

const failingOutput: DeviceCommandResult = {
  commandId: 'cmd-2',
  success: false,
  result: {
    exitCode: 1,
    stdout: '',
    stderr: 'The term is not recognized',
    truncated: false,
    durationMs: 5,
  },
};

const job = {
  taskId: 'task-device-1',
  userId: 'user-device',
  projectId: 'proj-device',
  kind: 'windows_command',
  attempt: 0,
  maxAttempts: 3,
};

const makeExecutor = (
  repo: RecordingTaskRepo,
  dispatcher: DeviceDispatcher,
  approvals: string[] = [],
) => {
  const guard = new SecuredCapabilityGuard(new PermissionEngine(), {
    approvalValidator: {
      validateAndConsume: async (approvalId: string, expectedFingerprint: string) => {
        const valid =
          approvalId === 'appr-approved' && approvals.includes(expectedFingerprint);
        return valid ? { valid: true } : { valid: false, reason: 'fingerprint mismatch' };
      },
    },
  });
  const created: Array<{ fingerprint: string; action: string }> = [];
  const executor = new TaskExecutor(repo, { publish: () => undefined }, {
    deviceDispatcher: dispatcher,
    guard,
    approvalCreator: async (params) => {
      created.push({ fingerprint: params.fingerprint, action: params.action });
      return { id: 'appr-approved' };
    },
  });
  return { executor, created };
};

test('Device task: a device command waits for approval, then completes with the real output as artifact', async () => {
  const dispatched: Array<Record<string, unknown>> = [];
  const dispatcher: DeviceDispatcher = {
    listOnlineDevices: async () => ['win-1'],
    dispatchCommand: async (request) => {
      dispatched.push(request);
      return hostnameOutput;
    },
  };

  const first = new RecordingTaskRepo({ targetDevice: 'win-1', command: 'hostname' });
  const { executor, created } = makeExecutor(first, dispatcher);
  await executor.execute(job);

  // The command is HIGH risk, so it must not reach the device before a human approves it.
  assert.equal(dispatched.length, 0);
  const approvalEvent = first.events.find((e) => e.eventType === 'task.waiting_approval');
  assert.ok(approvalEvent, 'a device command must stop at an approval request');
  assert.equal(approvalEvent.payload['action'], 'device:command');
  assert.equal(approvalEvent.payload['riskLevel'], 'HIGH');
  assert.equal(approvalEvent.payload['deviceId'], 'win-1');
  assert.equal((await first.getTask())?.status, 'waiting_approval');
  assert.equal(created[0]?.action, 'device:command');

  // Resume with the granted approval, exactly as the approvals route re-enqueues the task.
  const resumed = new RecordingTaskRepo({ targetDevice: 'win-1', command: 'hostname' });
  resumed.markApproved('appr-approved');
  const approved = makeExecutor(resumed, dispatcher, [created[0]!.fingerprint]);
  await approved.executor.execute(job);

  assert.equal(dispatched.length, 1, 'the approved command must reach the device exactly once');
  assert.equal(dispatched[0]?.['command'], 'hostname');
  assert.equal(dispatched[0]?.['deviceId'], 'win-1');
  assert.equal(dispatched[0]?.['userId'], 'user-device');

  const completed = resumed.events.find((e) => e.eventType === 'task.completed');
  assert.ok(completed, 'an approved dispatch must complete the task');
  assert.equal(completed.payload['exitCode'], 0);
  const artifacts = completed.payload['artifacts'] as Array<{ content: string }>;
  assert.match(artifacts[0]!.content, /DESKTOP-ABC/);
});

test('Device task: an approval for one command does not authorise a different one', async () => {
  const dispatched: Array<Record<string, unknown>> = [];
  const dispatcher: DeviceDispatcher = {
    listOnlineDevices: async () => ['win-1'],
    dispatchCommand: async (request) => {
      dispatched.push(request);
      return hostnameOutput;
    },
  };

  const original = new RecordingTaskRepo({ targetDevice: 'win-1', command: 'hostname' });
  const { executor, created } = makeExecutor(original, dispatcher);
  await executor.execute(job);

  // Same device, different command text: the fingerprint must not carry over.
  const swapped = new RecordingTaskRepo({ targetDevice: 'win-1', command: 'Remove-Item -Recurse' });
  swapped.markApproved('appr-approved');
  const run = makeExecutor(swapped, dispatcher, [created[0]!.fingerprint]);
  await run.executor.execute(job);

  assert.equal(dispatched.length, 0, 'the swapped command must not reuse the old approval');
  const task = await swapped.getTask();
  assert.equal(task?.status, 'failed');
  assert.match(task?.error ?? '', /tidak diotorisasi/);
  assert.ok(!swapped.events.some((e) => e.eventType === 'task.completed'));
});

test('Device task: an approved command still runs when the agent reconnects after an API restart', async () => {
  const dispatched: Array<Record<string, unknown>> = [];
  // Sessions live in the API process, so a restart makes every device look offline until the agent
  // dials back in. The command was already authorised; failing here would burn the approval and
  // make the user approve the same command twice.
  let online = ['win-1'];
  const dispatcher: DeviceDispatcher = {
    listOnlineDevices: async () => online,
    dispatchCommand: async (request) => {
      dispatched.push(request);
      return hostnameOutput;
    },
  };

  const first = new RecordingTaskRepo({ targetDevice: 'win-1', command: 'hostname' });
  const { executor, created } = makeExecutor(first, dispatcher);
  await executor.execute(job);

  online = [];
  const resumed = new RecordingTaskRepo({ targetDevice: 'win-1', command: 'hostname' });
  resumed.markApproved('appr-approved');
  const approved = makeExecutor(resumed, dispatcher, [created[0]!.fingerprint]);
  await approved.executor.execute(job);

  assert.equal(dispatched.length, 1, 'the approved command must reach the device exactly once');
  assert.equal((await resumed.getTask())?.status, 'completed');
  assert.ok(!resumed.events.some((e) => e.eventType === 'task.failed'));
});

test('Device task: a non-zero exit fails the task instead of reporting the command as done', async () => {
  const dispatched: Array<Record<string, unknown>> = [];
  const dispatcher: DeviceDispatcher = {
    listOnlineDevices: async () => ['win-1'],
    dispatchCommand: async (request) => {
      dispatched.push(request);
      return failingOutput;
    },
  };

  const first = new RecordingTaskRepo({ targetDevice: 'win-1', command: 'exit 1' });
  const { executor, created } = makeExecutor(first, dispatcher);
  await executor.execute(job);

  const resumed = new RecordingTaskRepo({ targetDevice: 'win-1', command: 'exit 1' });
  resumed.markApproved('appr-approved');
  const run = makeExecutor(resumed, dispatcher, [created[0]!.fingerprint]);
  await run.executor.execute(job);

  assert.equal(dispatched.length, 1, 'the approved command must actually reach the device');
  const task = await resumed.getTask();
  assert.equal(task?.status, 'failed');
  const failEvent = resumed.events.find((e) => e.eventType === 'task.failed');
  assert.match(String(failEvent?.payload['error']), /Perintah pada perangkat gagal/);
  assert.match(String(failEvent?.payload['error']), /exit code 1/);
  assert.ok(!resumed.events.some((e) => e.eventType === 'task.completed'));
});

test('Device task: an offline device fails transparently and never fabricates a result', async () => {
  const repo = new RecordingTaskRepo({ targetDevice: 'win-gone', command: 'hostname' });
  let dispatchAttempted = false;
  const { executor } = makeExecutor(repo, {
    listOnlineDevices: async () => [],
    dispatchCommand: async () => {
      dispatchAttempted = true;
      return hostnameOutput;
    },
  });

  await executor.execute(job);

  assert.equal(dispatchAttempted, false);
  const task = await repo.getTask();
  assert.equal(task?.status, 'failed');
  assert.match(task?.error ?? '', /"win-gone" sedang offline/);
  const failEvent = repo.events.find((e) => e.eventType === 'task.failed');
  assert.equal(failEvent?.payload['offlineReason'], 'device_unreachable');
  assert.equal(failEvent?.payload['deviceId'], 'win-gone');
});

test('Device task: without a dispatcher the task fails instead of completing silently', async () => {
  const repo = new RecordingTaskRepo({ targetDevice: 'win-1', command: 'hostname' });
  const executor = new TaskExecutor(repo, { publish: () => undefined }, {});

  await executor.execute(job);

  const task = await repo.getTask();
  assert.equal(task?.status, 'failed');
  assert.ok(!repo.events.some((e) => e.eventType === 'task.completed'));
});
