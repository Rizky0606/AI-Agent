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
  onScheduleBrief?: ((scheduleId: string, brief: string) => Promise<void>) | undefined;
}

const buildNotificationData = (
  event: TaskEventEnvelope,
  type: NotificationType,
): { title: string; body: string; deepLink: string } => {
  const isScheduled = Boolean(event.payload['isScheduled'] || event.payload['scheduleId']);
  const scheduleName = event.payload['scheduleName'] ? String(event.payload['scheduleName']) : 'Tugas Terjadwal';

  if (isScheduled) {
    if (event.eventType === 'task.completed') {
      const brief = String(event.payload['brief'] ?? event.payload['result'] ?? 'Tugas terjadwal selesai.');
      return {
        title: `[Jadwal] ${scheduleName}: Ringkasan Tersedia`,
        body: brief,
        deepLink: `/activity?tab=tasks&taskId=${event.taskId}`,
      };
    }
    if (event.eventType === 'task.waiting_approval') {
      const action = String(event.payload['action'] ?? 'aksi sensitif');
      return {
        title: `[Jadwal] ${scheduleName}: Menunggu Persetujuan`,
        body: `Eksekusi terjadwal ditangguhkan pada aksi "${action}". Ringkasan mencatat status tertunda.`,
        deepLink: `/activity?tab=approvals&approvalId=${String(event.payload['approvalId'] ?? '')}`,
      };
    }
    if (event.eventType === 'task.failed') {
      const errorMsg = String(event.payload['error'] ?? 'Terjadi kesalahan.');
      return {
        title: `[Jadwal] ${scheduleName}: Gagal`,
        body: `Tugas terjadwal gagal dieksekusi: ${errorMsg}`,
        deepLink: `/activity?tab=tasks&taskId=${event.taskId}`,
      };
    }
  }

  // Non-scheduled task notifications
  const approvalId = event.payload['approvalId'];
  const deepLink =
    type === 'approval_required' && approvalId
      ? `personal-ai://approvals/${String(approvalId)}`
      : `personal-ai://tasks/${event.taskId}`;

  return {
    title: TITLE_BY_NOTIFICATION_TYPE[type],
    body: bodyFromEvent(event),
    deepLink,
  };
};

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
    const notification = buildNotificationData(event, type);

    // Jika ini tugas terjadwal dan ada brief, perbarui riwayat brief jadwal
    const scheduleId = event.payload['scheduleId'];
    if (scheduleId && typeof scheduleId === 'string' && deps.onScheduleBrief) {
      const briefContent = String(
        event.payload['brief'] ?? event.payload['result'] ?? notification.body,
      );
      void deps.onScheduleBrief(scheduleId, briefContent).catch(() => {});
    }

    void deps.notificationEngine
      .dispatchNotification({
        userId: event.userId,
        type,
        title: notification.title,
        body: notification.body,
        data: {
          taskId: event.taskId,
          approvalId: typeof approvalId === 'string' ? approvalId : undefined,
          deepLink: notification.deepLink,
        },
      })
      .catch((err: unknown) => {
        deps.onError(err, event);
      });
  };
};
