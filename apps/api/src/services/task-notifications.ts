import type { NotificationEngine, NotificationType } from '@personal-ai-os/scheduler';
import type { TaskEventEnvelope, TaskEventType } from '@personal-ai-os/shared';

const NOTIFICATION_TYPE_BY_EVENT: Partial<Record<TaskEventType, NotificationType>> = {
  'task.completed': 'task_completed',
  'task.failed': 'task_failed',
  'task.waiting_approval': 'approval_required',
};

const TITLE_BY_NOTIFICATION_TYPE: Record<NotificationType, string> = {
  approval_required: 'Persetujuan dibutuhkan',
  task_completed: 'Task selesai',
  task_failed: 'Task gagal',
  blocker: 'Blocker',
  system_alert: 'Peringatan sistem',
};

const bodyFromEvent = (event: TaskEventEnvelope): string => {
  if (event.eventType === 'task.completed') {
    return String(event.payload['result'] ?? 'Task selesai tanpa ringkasan hasil.');
  }
  if (event.eventType === 'task.failed') {
    return String(event.payload['error'] ?? 'Task gagal tanpa pesan kesalahan.');
  }
  return String(
    event.payload['consequence'] ??
      event.payload['action'] ??
      'Aksi berisiko menunggu persetujuan Anda.',
  );
};

export interface TaskNotificationDeps {
  notificationEngine: NotificationEngine;
  onError: (err: unknown, event: TaskEventEnvelope) => void;
}

/**
 * Menerjemahkan event task yang dipublikasikan ke Redis menjadi baris notifikasi durable.
 * Kegagalan di sini tidak menggagalkan jalur task; hanya dicatat lewat `onError`.
 */
export const createTaskNotificationListener = (
  deps: TaskNotificationDeps,
): ((event: TaskEventEnvelope) => void) => {
  return (event: TaskEventEnvelope): void => {
    const type = NOTIFICATION_TYPE_BY_EVENT[event.eventType];
    if (!type) return;

    const approvalId = event.payload['approvalId'];
    void deps.notificationEngine
      .dispatchNotification({
        userId: event.userId,
        type,
        title: TITLE_BY_NOTIFICATION_TYPE[type],
        body: bodyFromEvent(event),
        data: {
          taskId: event.taskId,
          approvalId: typeof approvalId === 'string' ? approvalId : undefined,
        },
      })
      .catch((err: unknown) => {
        deps.onError(err, event);
      });
  };
};
