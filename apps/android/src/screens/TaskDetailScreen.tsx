import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { theme } from '../components/Theme.ts';
import {
  useCancelTask,
  usePauseTask,
  useResumeTask,
  useTask,
  useTaskEvents,
} from '../hooks/use-queries.ts';
import { TaskEventsWebSocketClient } from '../services/task-events-websocket.ts';
import {
  aggregateRuntimeSteps,
  sortRuntimeEvents,
  type TaskEventEnvelope,
} from '@personal-ai-os/shared';
import { getRuntimeOutputPreviews } from '../runtime-output.ts';

interface DiffBlockProps {
  diff: string;
  path?: string | undefined;
}

export const DiffBlock: React.FC<DiffBlockProps> = ({ diff, path }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = diff.length > 200 || diff.split('\n').length > 6;

  return (
    <View style={styles.diffContainer}>
      {path ? <Text style={styles.diffPathText}>File: {path}</Text> : null}
      <View style={{ maxHeight: isLong && !expanded ? 140 : undefined, overflow: 'hidden' }}>
        <Text style={styles.diffCodeText}>{diff}</Text>
      </View>
      {isLong ? (
        <TouchableOpacity
          style={styles.diffExpandBtn}
          onPress={() => setExpanded(!expanded)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Tutup diff' : 'Lihat semua'}
        >
          <Text style={styles.diffExpandText}>{expanded ? 'Tutup diff' : 'Lihat semua'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

export interface TaskDetailScreenProps {
  taskId: string;
  onBack: () => void;
  onNavigateToApproval?: (approvalId: string) => void;
}

export const TaskDetailScreen: React.FC<TaskDetailScreenProps> = ({
  taskId,
  onBack,
  onNavigateToApproval,
}) => {
  const { data: task, isLoading, refetch } = useTask(taskId);
  const { data: initialEvents } = useTaskEvents(taskId);
  const [liveEvents, setLiveEvents] = useState<TaskEventEnvelope[]>([]);

  const pauseMutation = usePauseTask();
  const resumeMutation = useResumeTask();
  const cancelMutation = useCancelTask();

  useEffect(() => {
    if (initialEvents) {
      setLiveEvents(sortRuntimeEvents(initialEvents));
    }
  }, [initialEvents]);

  // Realtime streaming of task events with auto-replay
  useEffect(() => {
    const ws = new TaskEventsWebSocketClient({
      taskId,
      onEvent: (evt) => {
        setLiveEvents((prev) => {
          if (prev.some((e) => e.id === evt.id)) return prev;
          return sortRuntimeEvents([...prev, evt]);
        });
        void refetch();
      },
    });

    void ws.connect();
    return () => {
      ws.disconnect();
    };
  }, [taskId, refetch]);

  if (isLoading || !task) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </View>
    );
  }

  const checkpoint = task.checkpoint;
  const currentStep = checkpoint?.stepIndex ?? 1;
  const totalSteps = checkpoint?.totalSteps ?? 4;
  const pendingSteps = Math.max(0, totalSteps - currentStep);
  const runtimeOutputs = getRuntimeOutputPreviews(task.artifacts);

  // Transform events into unified timeline items with runtime step aggregation
  const runtimeSteps = aggregateRuntimeSteps(liveEvents);

  const humanTimeline = (() => {
    if (runtimeSteps.length > 0) {
      // Map aggregated runtime steps
      const stepItems = runtimeSteps.map((step) => ({
        id: step.id,
        title: `Langkah #${step.stepNumber}: ${step.toolName}`,
        detail: step.summary,
        diff: step.diff,
        path: step.path,
        status: step.status as 'running' | 'completed' | 'failed' | undefined,
        runtime: step.runtime,
        time: step.timestamp ? new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      }));

      // Include high-level lifecycle events in timeline
      const lifecycleItems = liveEvents
        .filter((e) => ['task.created', 'task.waiting_approval', 'task.completed', 'task.failed', 'task.paused', 'task.resumed', 'task.cancelled'].includes(e.eventType))
        .map((evt) => {
          let title = 'Pembaruan Tugas';
          let detail = '';
          let status: 'running' | 'completed' | 'failed' | undefined;
          if (evt.eventType === 'task.created') { title = 'Tugas Dibuat'; detail = 'Tugas dimasukkan ke dalam antrean eksekusi sistem.'; }
          else if (evt.eventType === 'task.waiting_approval') { title = 'Menunggu Persetujuan Anda ⚠️'; detail = String(evt.payload?.action ?? 'Memerlukan otorisasi pengguna.'); }
          else if (evt.eventType === 'task.completed') { title = 'Tugas Selesai'; detail = 'Semua instruksi berhasil dieksekusi.'; status = 'completed'; }
          else if (evt.eventType === 'task.failed') { title = 'Tugas Gagal'; detail = String(evt.payload?.error ?? 'Terjadi kendala saat mengeksekusi.'); status = 'failed'; }
          else if (evt.eventType === 'task.paused') { title = 'Tugas Dijeda'; detail = 'Eksekusi dihentikan sementara.'; }
          else if (evt.eventType === 'task.resumed') { title = 'Tugas Dilanjutkan'; detail = 'Persetujuan diberikan, eksekusi dilanjutkan.'; }
          else if (evt.eventType === 'task.cancelled') { title = 'Tugas Dibatalkan'; detail = 'Pengguna membatalkan proses pengerjaan.'; status = 'failed'; }
          return {
            id: evt.id,
            title,
            detail,
            diff: undefined,
            path: undefined,
            status,
            runtime: undefined,
            time: new Date(evt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
        });

      return [...lifecycleItems.filter((i) => i.title === 'Tugas Dibuat'), ...stepItems, ...lifecycleItems.filter((i) => i.title !== 'Tugas Dibuat')];
    }

    // Fallback mapping for non-runtime tasks
    return liveEvents.map((evt) => {
      let title = 'Pembaruan Tugas';
      let detail = '';
      let diff: string | undefined;
      let path: string | undefined;
      let status: 'running' | 'completed' | 'failed' | undefined;

      switch (evt.eventType) {
        case 'task.created':
          title = 'Tugas Dibuat';
          detail = 'Tugas dimasukkan ke dalam antrean eksekusi sistem.';
          break;
        case 'task.started':
          title = 'Eksekusi Dimulai';
          detail = 'Asisten AI mulai menganalisis rencana kerja.';
          status = 'running';
          break;
        case 'task.progress':
          if (evt.payload?.action === 'file_edit') {
            title = 'Modifikasi File (Diff)';
            path = typeof evt.payload?.path === 'string' ? evt.payload.path : undefined;
            diff = typeof evt.payload?.diff === 'string' ? evt.payload.diff : undefined;
            detail = path ? `Mengubah file: ${path}` : 'Perubahan file diterapkan.';
            status = 'completed';
          } else if (evt.payload?.action === 'runtime_fallback') {
            title = 'Pengalihan Runtime (Fallback)';
            detail = String(evt.payload?.fallbackReason ?? 'Runtime dialihkan karena kendala kesiapan sistem.');
          } else if (evt.payload?.action === 'runtime_stream') {
            title = 'Output Runtime (Streaming)';
            detail = String(evt.payload?.text ?? '');
          } else {
            title = `Progres: ${evt.payload?.progress ?? 0}%`;
            detail =
              typeof evt.payload?.action === 'string'
                ? `Langkah: ${evt.payload.action.replace('_', ' ')}`
                : 'Menjalankan instruksi berurutan...';
          }
          break;
        case 'task.tool_call':
          title = 'Penggunaan Alat: ' + (evt.payload?.action ?? evt.payload?.tool ?? 'tool');
          detail =
            typeof evt.payload?.output === 'string'
              ? evt.payload.output.slice(0, 150)
              : 'Pemeriksaan resource / alat selesai.';
          status = evt.payload?.output ? 'completed' : 'running';
          break;
        case 'task.waiting_approval':
          title = 'Menunggu Persetujuan Anda ⚠️';
          detail =
            typeof evt.payload?.action === 'string'
              ? `Operasi berisiko (${evt.payload?.riskLevel ?? 'HIGH'}): ${evt.payload.action}`
              : 'Memerlukan otorisasi pengguna untuk melanjutkan.';
          break;
        case 'task.completed':
          title = 'Tugas Selesai';
          detail = 'Semua instruksi berhasil dieksekusi.';
          status = 'completed';
          break;
        case 'task.failed':
          title = 'Tugas Gagal';
          detail =
            typeof evt.payload?.error === 'string'
              ? evt.payload.error
              : 'Terjadi kendala saat mengeksekusi langkah.';
          status = 'failed';
          break;
        case 'task.resumed':
          title = 'Tugas Dilanjutkan';
          detail = 'Persetujuan diberikan, eksekusi dilanjutkan.';
          break;
        case 'task.paused':
          title = 'Tugas Dijeda';
          detail = 'Eksekusi dihentikan sementara.';
          break;
        case 'task.cancelled':
          title = 'Tugas Dibatalkan';
          detail = 'Pengguna membatalkan proses pengerjaan.';
          status = 'failed';
          break;
      }

      return {
        id: evt.id,
        title,
        detail,
        diff,
        path,
        status,
        runtime: typeof evt.payload?.runtime === 'string' ? evt.payload.runtime : undefined,
        time: new Date(evt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
    });
  })();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Detail Tugas
        </Text>
        <StatusPill status={task.status} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Waiting Approval Alert Banner */}
        {task.status === 'waiting_approval' ? (
          <View style={styles.approvalBanner}>
            <Text style={styles.bannerTitle}>⚠️ Persetujuan Diperlukan</Text>
            <Text style={styles.bannerDesc}>
              Tugas ini dihentikan sementara karena aksi yang akan dijalankan memerlukan konfirmasi
              izin dari Anda.
            </Text>
            {onNavigateToApproval && task.checkpoint?.actionState?.approvalId ? (
              <TouchableOpacity
                style={styles.bannerActionBtn}
                onPress={() =>
                  onNavigateToApproval(task.checkpoint?.actionState?.approvalId as string)
                }
              >
                <Text style={styles.bannerActionText}>Buka Kotak Persetujuan →</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* Overview Card */}
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.taskKindTitle}>{task.kind.replace('_', ' ').toUpperCase()}</Text>
            {Boolean(task.payload?.runtime || task.payload?.selectedRuntimeId) && (
              <Text style={styles.runtimeBadgeText}>
                {String(task.payload?.runtime || task.payload?.selectedRuntimeId)}
              </Text>
            )}
          </View>

          {task.payload?.runtimeFallback === true ? (
            <View style={styles.fallbackNotice}>
              <Text style={styles.fallbackNoticeTitle}>⚠️ Pengalihan Runtime Otomatis</Text>
              <Text style={styles.fallbackNoticeText}>
                {String(task.payload?.fallbackReason || `Dialihkan dari ${task.payload?.originalRuntimeId}`)}
              </Text>
            </View>
          ) : null}

          <View style={styles.progressRow}>
            <Text style={styles.label}>Penyelesaian</Text>
            <Text style={styles.percentText}>{task.progress}%</Text>
          </View>
          <ProgressBar progress={task.progress} />

          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Langkah Selesai</Text>
              <Text style={styles.statValue}>
                {currentStep} / {totalSteps}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Sisa Langkah</Text>
              <Text style={styles.statValue}>{pendingSteps}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Percobaan</Text>
              <Text style={styles.statValue}>
                {task.attempt} / {task.maxAttempts}
              </Text>
            </View>
          </View>

          {task.error ? (
            <View style={styles.errorNotice}>
              <Text style={styles.errorText}>Keterangan Masalah: {task.error}</Text>
            </View>
          ) : null}
        </View>
        {runtimeOutputs.map((output) => (
          <View key={output.id} style={styles.runtimeOutputCard}>
            <Text style={styles.sectionHeading}>{output.title}</Text>
            <Text style={styles.runtimeOutputWarning}>Output runtime adalah data tidak tepercaya; pratinjau teks dibatasi.</Text>
            <ScrollView style={styles.runtimeOutputScroll} nestedScrollEnabled>
              <Text selectable style={styles.runtimeOutputText}>{output.content}</Text>
            </ScrollView>
            {output.truncated ? <Text style={styles.runtimeOutputWarning}>Pratinjau dibatasi 20.000 karakter; artifact lengkap tetap tersimpan.</Text> : null}
          </View>
        ))}

        {/* Action Controls */}
        <View style={styles.controlsRow}>
          {task.status === 'running' && task.payload?.supportsPause === true ? (
            <TouchableOpacity
              style={[styles.controlBtn, styles.pauseBtn]}
              onPress={() => pauseMutation.mutate(task.id)}
            >
              <Text style={styles.controlBtnText}>Jeda (Pause)</Text>
            </TouchableOpacity>
          ) : null}

          {task.status === 'paused' && task.payload?.supportsPause === true ? (
            <TouchableOpacity
              style={[styles.controlBtn, styles.resumeBtn]}
              onPress={() => resumeMutation.mutate(task.id)}
            >
              <Text style={styles.controlBtnText}>Lanjutkan (Resume)</Text>
            </TouchableOpacity>
          ) : null}

          {task.status !== 'completed' &&
          task.status !== 'cancelled' &&
          task.status !== 'failed' ? (
            <TouchableOpacity
              style={[styles.controlBtn, styles.cancelBtn]}
              onPress={() => cancelMutation.mutate(task.id)}
            >
              <Text style={styles.controlBtnText}>Hentikan</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Human-Friendly Timeline */}
        <View style={styles.timelineSection}>
          <Text style={styles.sectionHeading}>Aktivitas yang Dilakukan</Text>
          {humanTimeline.length === 0 ? (
            <Text style={styles.emptyTimelineText}>Belum ada aktivitas tercatat.</Text>
          ) : (
            humanTimeline.map((item, idx) => (
              <View key={item.id || idx} style={styles.timelineItem}>
                <View
                  style={[
                    styles.timelineDot,
                    item.status === 'failed'
                      ? styles.timelineDotFailed
                      : item.status === 'completed'
                        ? styles.timelineDotCompleted
                        : null,
                  ]}
                />
                <View style={styles.timelineBody}>
                  <View style={styles.timelineHeaderRow}>
                    <View style={styles.timelineTitleGroup}>
                      <Text style={styles.timelineTitle}>{item.title}</Text>
                      {item.runtime ? (
                        <View style={styles.timelineRuntimeBadge}>
                          <Text style={styles.timelineRuntimeBadgeText}>{item.runtime}</Text>
                        </View>
                      ) : null}
                      {item.status ? (
                        <View
                          style={[
                            styles.statusBadge,
                            item.status === 'failed'
                              ? styles.statusFailed
                              : item.status === 'completed'
                                ? styles.statusCompleted
                                : styles.statusRunning,
                          ]}
                        >
                          <Text style={styles.statusBadgeText}>
                            {item.status === 'completed'
                              ? 'Selesai'
                              : item.status === 'failed'
                                ? 'Gagal'
                                : 'Berjalan'}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.timelineTime}>{item.time}</Text>
                  </View>
                  <Text style={styles.timelineDetail}>{item.detail}</Text>
                  {item.diff ? (
                    <DiffBlock diff={item.diff} path={item.path} />
                  ) : null}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceBorder,
  },
  backBtn: {
    padding: theme.spacing.xs,
    marginRight: theme.spacing.sm,
  },
  backBtnText: {
    color: theme.colors.primary,
    fontSize: 22,
    fontWeight: 'bold',
  },
  headerTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: theme.spacing.md,
  },
  approvalBanner: {
    backgroundColor: theme.colors.riskMediumBg,
    borderColor: theme.colors.warning,
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  bannerTitle: {
    color: theme.colors.warning,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  bannerDesc: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: theme.spacing.sm,
  },
  bannerActionBtn: {
    backgroundColor: theme.colors.warning,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.borderRadius.sm,
    alignSelf: 'flex-start',
  },
  bannerActionText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 12,
  },
  card: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    marginBottom: theme.spacing.md,
  },
  taskKindTitle: {
    color: theme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: theme.spacing.sm,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  percentText: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.surfaceBorder,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    color: theme.colors.textMuted,
    fontSize: 10,
    marginBottom: 2,
  },
  statValue: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  runtimeBadgeText: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
  },
  fallbackNotice: {
    backgroundColor: theme.colors.riskHighBg,
    borderColor: theme.colors.warning,
    borderWidth: 1,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.md,
  },
  fallbackNoticeTitle: {
    color: theme.colors.warning,
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 2,
  },
  fallbackNoticeText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
  errorNotice: {
    backgroundColor: theme.colors.dangerBg,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginTop: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 12,
  },
  controlsRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.lg,
  },
  controlBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  pauseBtn: {
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
  },
  resumeBtn: {
    backgroundColor: theme.colors.primary,
  },
  cancelBtn: {
    backgroundColor: theme.colors.dangerBg,
    borderWidth: 1,
    borderColor: theme.colors.danger,
  },
  controlBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  runtimeOutputCard: { backgroundColor: theme.colors.surface, padding: theme.spacing.md, borderRadius: theme.borderRadius.md, borderWidth: 1, borderColor: theme.colors.surfaceBorder, marginBottom: theme.spacing.md },
  runtimeOutputWarning: { color: theme.colors.warning, fontSize: 12, marginBottom: theme.spacing.sm },
  runtimeOutputScroll: { maxHeight: 320, backgroundColor: theme.colors.background, borderRadius: theme.borderRadius.sm, padding: theme.spacing.sm },
  runtimeOutputText: { color: theme.colors.textPrimary, fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
  timelineSection: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
  },
  sectionHeading: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: theme.spacing.md,
  },
  emptyTimelineText: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
    marginTop: 5,
    marginRight: theme.spacing.sm,
  },
  timelineBody: {
    flex: 1,
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  timelineTitle: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  timelineTime: {
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  timelineTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  timelineDetail: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  timelineDotCompleted: {
    backgroundColor: theme.colors.success,
  },
  timelineDotFailed: {
    backgroundColor: theme.colors.danger,
  },
  timelineRuntimeBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  timelineRuntimeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#38bdf8',
    textTransform: 'uppercase',
  },
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  statusRunning: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.4)',
  },
  statusCompleted: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.4)',
  },
  statusFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  diffContainer: {
    marginTop: 8,
    padding: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
  },
  diffPathText: {
    color: theme.colors.primary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    fontFamily: 'monospace',
  },
  diffCodeText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: theme.colors.textPrimary,
    lineHeight: 15,
  },
  diffExpandBtn: {
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  diffExpandText: {
    color: theme.colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
});
