import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { ScreenHeader } from '../components/ScreenHeader.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';
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
  const theme = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const isLong = diff.length > 200 || diff.split('\n').length > 6;

  return (
    <View
      style={[
        styles.diffContainer,
        {
          backgroundColor: theme.scheme === 'dark' ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.05)',
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      {path ? (
        <Text style={[styles.diffPathText, { color: theme.colors.primary }]} allowFontScaling>
          File: {path}
        </Text>
      ) : null}
      <View style={{ maxHeight: isLong && !expanded ? 140 : undefined, overflow: 'hidden' }}>
        <Text
          style={[styles.diffCodeText, { color: theme.colors.textPrimary }]}
          allowFontScaling
          selectable
        >
          {diff}
        </Text>
      </View>
      {isLong ? (
        <Pressable
          android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
          style={styles.diffExpandBtn}
          onPress={() => setExpanded(!expanded)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Tutup diff' : 'Lihat semua'}
        >
          <Text style={[styles.diffExpandText, { color: theme.colors.primary }]} allowFontScaling>
            {expanded ? 'Tutup diff' : 'Lihat semua'}
          </Text>
        </Pressable>
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
  const theme = useAppTheme();
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
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
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
          else if (evt.eventType === 'task.waiting_approval') { title = 'Menunggu Persetujuan Anda'; detail = String(evt.payload?.action ?? 'Memerlukan otorisasi pengguna.'); }
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
          title = 'Menunggu Persetujuan Anda';
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
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Native-style Standard Header */}
      <ScreenHeader
        title="Detail Tugas"
        onBack={onBack}
        rightElement={<StatusPill status={task.status} />}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Waiting Approval Alert Banner */}
        {task.status === 'waiting_approval' ? (
          <View
            style={[
              styles.approvalBanner,
              {
                backgroundColor: theme.colors.riskHighBg,
                borderColor: theme.colors.riskHigh,
              },
            ]}
          >
            <View style={styles.bannerTitleRow}>
              <AlertTriangle size={18} color={theme.colors.riskHigh} />
              <Text
                style={[styles.bannerTitle, { color: theme.colors.riskHigh }]}
                allowFontScaling
              >
                Persetujuan Diperlukan
              </Text>
            </View>
            <Text
              style={[styles.bannerDesc, { color: theme.colors.textPrimary }]}
              allowFontScaling
            >
              Tugas ini dihentikan sementara karena aksi yang akan dijalankan memerlukan konfirmasi
              izin dari Anda.
            </Text>
            {onNavigateToApproval && task.checkpoint?.actionState?.approvalId ? (
              <Pressable
                android_ripple={{ color: 'rgba(0, 0, 0, 0.15)' }}
                style={[styles.bannerActionBtn, { backgroundColor: theme.colors.riskHigh }]}
                onPress={() =>
                  onNavigateToApproval(task.checkpoint?.actionState?.approvalId as string)
                }
                accessibilityRole="button"
                accessibilityLabel="Buka Kotak Persetujuan"
              >
                <Text style={styles.bannerActionText} allowFontScaling>
                  Buka Kotak Persetujuan →
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Overview Card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <View style={styles.titleRow}>
            <Text
              style={[styles.taskKindTitle, { color: theme.colors.textPrimary }]}
              allowFontScaling
            >
              {task.kind.replace('_', ' ').toUpperCase()}
            </Text>
            {Boolean(task.payload?.runtime || task.payload?.selectedRuntimeId) && (
              <Text
                style={[
                  styles.runtimeBadgeText,
                  {
                    color: theme.colors.primary,
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.surfaceBorder,
                  },
                ]}
                allowFontScaling
              >
                {String(task.payload?.runtime || task.payload?.selectedRuntimeId)}
              </Text>
            )}
          </View>

          {task.payload?.runtimeFallback === true ? (
            <View
              style={[
                styles.fallbackNotice,
                {
                  backgroundColor: theme.colors.riskHighBg,
                  borderColor: theme.colors.riskHigh,
                },
              ]}
            >
              <View style={styles.fallbackNoticeHeader}>
                <AlertTriangle size={15} color={theme.colors.riskHigh} />
                <Text
                  style={[styles.fallbackNoticeTitle, { color: theme.colors.riskHigh }]}
                  allowFontScaling
                >
                  Pengalihan Runtime Otomatis
                </Text>
              </View>
              <Text
                style={[styles.fallbackNoticeText, { color: theme.colors.textPrimary }]}
                allowFontScaling
              >
                {String(task.payload?.fallbackReason || `Dialihkan dari ${task.payload?.originalRuntimeId}`)}
              </Text>
            </View>
          ) : null}

          {/* Current / Last Action Headline */}
          {checkpoint?.lastExecutedAction ? (
            <View style={styles.checkpointActionBox}>
              <Text style={[styles.checkpointActionLabel, { color: theme.colors.textMuted }]}>
                Aksi Terakhir:
              </Text>
              <Text
                style={[styles.checkpointActionText, { color: theme.colors.textPrimary }]}
                numberOfLines={2}
                allowFontScaling
              >
                {checkpoint.lastExecutedAction}
              </Text>
            </View>
          ) : null}

          <View style={styles.progressRow}>
            <Text style={[styles.label, { color: theme.colors.textSecondary }]} allowFontScaling>
              Penyelesaian
            </Text>
            <Text
              style={[styles.percentText, { color: theme.colors.primary }]}
              allowFontScaling
            >
              {task.progress}%
            </Text>
          </View>
          <ProgressBar progress={task.progress} />

          <View
            style={[
              styles.statsGrid,
              { borderTopColor: theme.colors.surfaceBorder },
            ]}
          >
            <View style={styles.statBox}>
              <Text style={[styles.statLabel, { color: theme.colors.textMuted }]} allowFontScaling>
                Langkah Selesai
              </Text>
              <Text style={[styles.statValue, { color: theme.colors.textPrimary }]} allowFontScaling>
                {currentStep} / {totalSteps}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statLabel, { color: theme.colors.textMuted }]} allowFontScaling>
                Sisa Langkah
              </Text>
              <Text style={[styles.statValue, { color: theme.colors.textPrimary }]} allowFontScaling>
                {pendingSteps}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statLabel, { color: theme.colors.textMuted }]} allowFontScaling>
                Percobaan
              </Text>
              <Text style={[styles.statValue, { color: theme.colors.textPrimary }]} allowFontScaling>
                {task.attempt} / {task.maxAttempts}
              </Text>
            </View>
          </View>

          {task.error ? (
            <View
              style={[
                styles.errorNotice,
                { backgroundColor: theme.colors.dangerBg, borderColor: theme.colors.danger },
              ]}
            >
              <Text style={[styles.errorText, { color: theme.colors.danger }]} allowFontScaling>
                Keterangan Masalah: {task.error}
              </Text>
            </View>
          ) : null}
        </View>

        {runtimeOutputs.map((output) => (
          <View
            key={output.id}
            style={[
              styles.runtimeOutputCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            <Text
              style={[styles.sectionHeading, { color: theme.colors.textPrimary }]}
              allowFontScaling
            >
              {output.title}
            </Text>
            <Text
              style={[styles.runtimeOutputWarning, { color: theme.colors.riskHigh }]}
              allowFontScaling
            >
              Output runtime adalah data tidak tepercaya; pratinjau teks dibatasi.
            </Text>
            <ScrollView
              style={[
                styles.runtimeOutputScroll,
                { backgroundColor: theme.colors.surfaceElevated },
              ]}
              nestedScrollEnabled
            >
              <Text
                selectable
                style={[styles.runtimeOutputText, { color: theme.colors.textPrimary }]}
                allowFontScaling
              >
                {output.content}
              </Text>
            </ScrollView>
            {output.truncated ? (
              <Text
                style={[styles.runtimeOutputWarning, { color: theme.colors.riskHigh }]}
                allowFontScaling
              >
                Pratinjau dibatasi 20.000 karakter; artifact lengkap tetap tersimpan.
              </Text>
            ) : null}
          </View>
        ))}

        {/* Action Controls */}
        <View style={styles.controlsRow}>
          {task.status === 'running' && task.payload?.supportsPause === true ? (
            <Pressable
              android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
              style={[
                styles.controlBtn,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                  borderWidth: 1,
                },
              ]}
              onPress={() => pauseMutation.mutate(task.id)}
              accessibilityRole="button"
              accessibilityLabel="Jeda tugas"
            >
              <Text style={[styles.controlBtnText, { color: theme.colors.textPrimary }]}>
                Jeda (Pause)
              </Text>
            </Pressable>
          ) : null}

          {task.status === 'paused' && task.payload?.supportsPause === true ? (
            <Pressable
              android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
              style={[styles.controlBtn, { backgroundColor: theme.colors.primary }]}
              onPress={() => resumeMutation.mutate(task.id)}
              accessibilityRole="button"
              accessibilityLabel="Lanjutkan tugas"
            >
              <Text style={[styles.controlBtnText, { color: '#fff' }]}>
                Lanjutkan (Resume)
              </Text>
            </Pressable>
          ) : null}

          {task.status !== 'completed' &&
          task.status !== 'cancelled' &&
          task.status !== 'failed' ? (
            <Pressable
              android_ripple={{ color: 'rgba(239, 68, 68, 0.2)' }}
              style={[
                styles.controlBtn,
                {
                  backgroundColor: theme.colors.dangerBg,
                  borderColor: theme.colors.danger,
                  borderWidth: 1,
                },
              ]}
              onPress={() => cancelMutation.mutate(task.id)}
              accessibilityRole="button"
              accessibilityLabel="Hentikan tugas"
            >
              <Text style={[styles.controlBtnText, { color: theme.colors.danger }]}>
                Hentikan
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Human-Friendly Timeline */}
        <View
          style={[
            styles.timelineSection,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <Text
            style={[styles.sectionHeading, { color: theme.colors.textPrimary }]}
            allowFontScaling
          >
            Aktivitas yang Dilakukan
          </Text>
          {humanTimeline.length === 0 ? (
            <Text
              style={[styles.emptyTimelineText, { color: theme.colors.textMuted }]}
              allowFontScaling
            >
              Belum ada aktivitas tercatat.
            </Text>
          ) : (
            humanTimeline.map((item, idx) => (
              <View key={item.id || idx} style={styles.timelineItem}>
                <View
                  style={[
                    styles.timelineDot,
                    {
                      backgroundColor:
                        item.status === 'failed'
                          ? theme.colors.danger
                          : item.status === 'completed'
                            ? theme.colors.success
                            : theme.colors.primary,
                    },
                  ]}
                />
                <View style={styles.timelineBody}>
                  <View style={styles.timelineHeaderRow}>
                    <View style={styles.timelineTitleGroup}>
                      <Text
                        style={[styles.timelineTitle, { color: theme.colors.textPrimary }]}
                        allowFontScaling
                      >
                        {item.title}
                      </Text>
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
                    <Text
                      style={[styles.timelineTime, { color: theme.colors.textMuted }]}
                      allowFontScaling
                    >
                      {item.time}
                    </Text>
                  </View>
                  <Text
                    style={[styles.timelineDetail, { color: theme.colors.textSecondary }]}
                    allowFontScaling
                  >
                    {item.detail}
                  </Text>
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
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  approvalBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  bannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  bannerDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  bannerActionBtn: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerActionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  taskKindTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 8,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    fontSize: 12,
  },
  percentText: {
    fontSize: 13,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 10,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  runtimeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  fallbackNotice: {
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  fallbackNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  fallbackNoticeTitle: {
    fontWeight: '700',
    fontSize: 12,
  },
  fallbackNoticeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  checkpointActionBox: {
    marginVertical: 8,
    paddingVertical: 4,
  },
  checkpointActionLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  checkpointActionText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
  errorNotice: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
  },
  errorText: {
    fontSize: 12,
  },
  controlsRow: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  controlBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  runtimeOutputCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  runtimeOutputWarning: {
    fontSize: 12,
    marginBottom: 8,
  },
  runtimeOutputScroll: {
    maxHeight: 280,
    borderRadius: 8,
    padding: 10,
  },
  runtimeOutputText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  timelineSection: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  emptyTimelineText: {
    fontSize: 13,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    marginRight: 10,
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
    fontSize: 13,
    fontWeight: '700',
  },
  timelineTime: {
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
    fontSize: 12,
    lineHeight: 16,
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
    color: '#fff',
  },
  diffContainer: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  diffPathText: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    fontFamily: 'monospace',
  },
  diffCodeText: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 15,
  },
  diffExpandBtn: {
    marginTop: 6,
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  diffExpandText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
