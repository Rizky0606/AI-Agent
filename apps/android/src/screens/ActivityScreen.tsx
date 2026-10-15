import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Plus } from 'lucide-react-native';
import type { ApprovalRequest, TaskItem } from '../api/types.ts';
import { ApprovalBottomSheet } from '../components/ApprovalBottomSheet.tsx';
import { ApprovalCard } from '../components/ApprovalCard.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';
import {
  useApprovals,
  useApproveRequest,
  useCreateTask,
  useDenyRequest,
  useTasks,
} from '../hooks/use-queries.ts';
import { idID } from '../locales/id-ID.ts';
import { createRuntimeTaskRequest } from '../runtime-task.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface ActivityScreenProps {
  onSelectTask: (taskId: string) => void;
  initialTab?: 'tasks' | 'approvals';
}

const TASK_STATUS_FILTERS = [
  { label: idID.activity.filterAll, value: null },
  { label: idID.activity.filterRunning, value: 'running' },
  { label: idID.activity.filterWaiting, value: 'waiting_approval' },
  { label: idID.activity.filterCompleted, value: 'completed' },
  { label: idID.activity.filterFailed, value: 'failed' },
];

const APPROVAL_FILTERS = [
  { label: idID.activity.filterWaiting, value: 'pending' },
  { label: idID.activity.filterAll, value: null },
  { label: idID.approval.badgeApproved, value: 'approved' },
  { label: idID.approval.badgeDenied, value: 'denied' },
];

export const ActivityScreen: React.FC<ActivityScreenProps> = ({
  onSelectTask,
  initialTab = 'tasks',
}) => {
  const theme = useAppTheme();
  const [activeTab, setActiveTab] = useState<'tasks' | 'approvals'>(initialTab);
  const {
    activeProjectId,
    taskStatusFilter,
    setTaskStatusFilter,
    approvalStatusFilter,
    setApprovalStatusFilter,
    showToast,
  } = useUiStore();

  // Queries
  const {
    data: tasks,
    isLoading: tasksLoading,
    refetch: refetchTasks,
  } = useTasks({
    projectId: activeProjectId ?? undefined,
    status: taskStatusFilter ?? undefined,
  });

  const {
    data: approvals,
    isLoading: approvalsLoading,
    refetch: refetchApprovals,
  } = useApprovals(approvalStatusFilter ?? undefined);

  // Pending count for badge
  const pendingApprovalsCount =
    approvals?.filter((a) => a.status === 'pending').length ?? 0;

  // Approval bottom sheet state
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const approveMutation = useApproveRequest();
  const denyMutation = useDenyRequest();

  // Task creation modal
  const createTask = useCreateTask();
  const [createVisible, setCreateVisible] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [runtime, setRuntime] = useState<'omp' | 'hermes'>('omp');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleOpenApprovalDetail = (approval: ApprovalRequest) => {
    setSelectedApproval(approval);
    setIsSheetOpen(true);
  };

  const handleApprove = async (approvalId: string, reason?: string) => {
    try {
      await approveMutation.mutateAsync({ approvalId, reason });
      showToast(idID.approval.approvedToast);
      setIsSheetOpen(false);
      setSelectedApproval(null);
      void refetchApprovals();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyetujui');
    }
  };

  const handleDeny = async (approvalId: string, reason?: string) => {
    try {
      await denyMutation.mutateAsync({ approvalId, reason });
      showToast(idID.approval.deniedToast);
      setIsSheetOpen(false);
      setSelectedApproval(null);
      void refetchApprovals();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menolak');
    }
  };

  const submitRuntimeTask = async () => {
    const instruction = prompt.trim();
    if (!activeProjectId) {
      setSubmitError('Pilih project terlebih dahulu.');
      return;
    }
    if (!instruction) {
      setSubmitError('Masukkan instruksi tugas.');
      return;
    }
    setSubmitError(null);
    try {
      const request = createRuntimeTaskRequest(
        activeProjectId,
        instruction,
        runtime,
        `${activeProjectId}/${Date.now()}`,
      );
      const { task } = await createTask.mutateAsync(request);
      setPrompt('');
      setCreateVisible(false);
      onSelectTask(task.id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Tugas gagal dibuat.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Top Segmented Tabs: Tugas vs Persetujuan */}
      <View
        style={[
          styles.segmentedContainer,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <TouchableOpacity
          accessibilityRole="tab"
          accessibilityLabel={idID.activity.tabTasks}
          accessibilityState={{ selected: activeTab === 'tasks' }}
          style={[
            styles.segmentButton,
            activeTab === 'tasks' && {
              borderBottomColor: theme.colors.primary,
              borderBottomWidth: 3,
            },
          ]}
          onPress={() => setActiveTab('tasks')}
        >
          <Text
            style={[
              styles.segmentText,
              {
                color:
                  activeTab === 'tasks'
                    ? theme.colors.primary
                    : theme.colors.textSecondary,
                fontWeight: activeTab === 'tasks' ? '700' : '600',
              },
            ]}
          >
            {idID.activity.tabTasks}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="tab"
          accessibilityLabel={`${idID.activity.tabApprovals}${
            pendingApprovalsCount > 0 ? `, ${pendingApprovalsCount} pending` : ''
          }`}
          accessibilityState={{ selected: activeTab === 'approvals' }}
          style={[
            styles.segmentButton,
            activeTab === 'approvals' && {
              borderBottomColor: theme.colors.primary,
              borderBottomWidth: 3,
            },
          ]}
          onPress={() => setActiveTab('approvals')}
        >
          <View style={styles.segmentWithBadge}>
            <Text
              style={[
                styles.segmentText,
                {
                  color:
                    activeTab === 'approvals'
                      ? theme.colors.primary
                      : theme.colors.textSecondary,
                  fontWeight: activeTab === 'approvals' ? '700' : '600',
                },
              ]}
            >
              {idID.activity.tabApprovals}
            </Text>
            {pendingApprovalsCount > 0 ? (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: theme.colors.riskHigh },
                ]}
              >
                <Text style={styles.badgeText}>{pendingApprovalsCount}</Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      </View>

      {/* Tab 1: Tasks Content */}
      {activeTab === 'tasks' ? (
        <View style={styles.tabContent}>
          {/* Header Action & Filter Bar */}
          <View style={styles.filterHeaderRow}>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={TASK_STATUS_FILTERS}
              keyExtractor={(item) => String(item.value)}
              contentContainerStyle={styles.filterChipsList}
              renderItem={({ item }) => {
                const isSelected = taskStatusFilter === item.value;
                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Filter ${item.label}`}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: isSelected
                          ? theme.colors.primary
                          : theme.colors.surfaceElevated,
                        borderColor: isSelected
                          ? theme.colors.primary
                          : theme.colors.surfaceBorder,
                      },
                    ]}
                    onPress={() => setTaskStatusFilter(item.value)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        {
                          color: isSelected ? '#fff' : theme.colors.textSecondary,
                          fontWeight: isSelected ? '700' : '600',
                        },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.activity.newRuntimeTask}
              style={[styles.createBtn, { backgroundColor: theme.colors.primary }]}
              onPress={() => {
                setSubmitError(null);
                setCreateVisible(true);
              }}
            >
              <Plus size={16} color="#fff" />
              <Text style={styles.createBtnText}>Tugas</Text>
            </TouchableOpacity>
          </View>

          {tasksLoading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator color={theme.colors.primary} size="large" />
            </View>
          ) : tasks?.length === 0 ? (
            <View style={styles.centerContainer}>
              <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
                {idID.activity.emptyTasks}
              </Text>
            </View>
          ) : (
            <FlatList
              data={tasks}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              onRefresh={refetchTasks}
              refreshing={tasksLoading}
              renderItem={({ item }: { item: TaskItem }) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Tugas ${item.kind}, status ${item.status}, progres ${item.progress}%`}
                  style={[
                    styles.taskCard,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.surfaceBorder,
                    },
                  ]}
                  onPress={() => onSelectTask(item.id)}
                >
                  <View style={styles.taskCardHeader}>
                    <Text
                      style={[styles.taskKindText, { color: theme.colors.textPrimary }]}
                      numberOfLines={1}
                    >
                      {item.kind}
                    </Text>
                    <StatusPill status={item.status} />
                  </View>

                  <View style={styles.progressContainer}>
                    <ProgressBar progress={item.progress} />
                    <Text
                      style={[
                        styles.progressPercent,
                        { color: theme.colors.textSecondary },
                      ]}
                    >
                      {item.progress}%
                    </Text>
                  </View>

                  <Text
                    style={[styles.taskTime, { color: theme.colors.textMuted }]}
                  >
                    {new Date(item.createdAt).toLocaleString()}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      ) : (
        /* Tab 2: Approvals Content */
        <View style={styles.tabContent}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={APPROVAL_FILTERS}
            keyExtractor={(item) => String(item.value)}
            contentContainerStyle={styles.filterChipsList}
            renderItem={({ item }) => {
              const isSelected = approvalStatusFilter === item.value;
              return (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Filter persetujuan ${item.label}`}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: isSelected
                        ? theme.colors.primary
                        : theme.colors.surfaceElevated,
                      borderColor: isSelected
                        ? theme.colors.primary
                        : theme.colors.surfaceBorder,
                    },
                  ]}
                  onPress={() => setApprovalStatusFilter(item.value)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      {
                        color: isSelected ? '#fff' : theme.colors.textSecondary,
                        fontWeight: isSelected ? '700' : '600',
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />

          {approvalsLoading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator color={theme.colors.primary} size="large" />
            </View>
          ) : approvals?.length === 0 ? (
            <View style={styles.centerContainer}>
              <Text
                style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}
              >
                {idID.activity.emptyApprovalsTitle}
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: theme.colors.textSecondary },
                ]}
              >
                {idID.activity.emptyApprovalsSubtitle}
              </Text>
            </View>
          ) : (
            <FlatList
              data={approvals}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              onRefresh={refetchApprovals}
              refreshing={approvalsLoading}
              renderItem={({ item }) => (
                <ApprovalCard
                  approval={item}
                  onPress={handleOpenApprovalDetail}
                />
              )}
            />
          )}
        </View>
      )}

      {/* Approval Detail Bottom Sheet */}
      <ApprovalBottomSheet
        visible={isSheetOpen}
        approval={selectedApproval}
        isLoading={approveMutation.isPending || denyMutation.isPending}
        onClose={() => {
          setIsSheetOpen(false);
          setSelectedApproval(null);
        }}
        onApprove={handleApprove}
        onDeny={handleDeny}
      />

      {/* Task Creation Modal */}
      <Modal
        visible={createVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            <Text
              style={[styles.modalTitle, { color: theme.colors.textPrimary }]}
            >
              {idID.activity.newRuntimeTask}
            </Text>
            <Text
              style={[styles.modalHint, { color: theme.colors.textSecondary }]}
            >
              {activeProjectId
                ? `Project: ${activeProjectId}`
                : 'Pilih project di tab Lainnya > Proyek terlebih dahulu.'}
            </Text>

            <View style={styles.runtimeChoices}>
              {(['omp', 'hermes'] as const).map((id) => (
                <TouchableOpacity
                  key={id}
                  style={[
                    styles.runtimeChoice,
                    {
                      backgroundColor:
                        runtime === id
                          ? theme.colors.primary
                          : theme.colors.surfaceElevated,
                      borderColor:
                        runtime === id
                          ? theme.colors.primary
                          : theme.colors.surfaceBorder,
                    },
                  ]}
                  onPress={() => setRuntime(id)}
                >
                  <Text
                    style={[
                      styles.runtimeChoiceText,
                      {
                        color: runtime === id ? '#fff' : theme.colors.textPrimary,
                      },
                    ]}
                  >
                    {id.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[
                styles.promptInput,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                  color: theme.colors.textPrimary,
                },
              ]}
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Instruksi untuk runtime..."
              placeholderTextColor={theme.colors.textMuted}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Instruksi tugas runtime"
            />

            {submitError ? (
              <Text style={[styles.errorText, { color: theme.colors.danger }]}>
                {submitError}
              </Text>
            ) : null}

            <View style={styles.modalActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={idID.common.cancel}
                style={[
                  styles.cancelButton,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.surfaceBorder,
                  },
                ]}
                onPress={() => setCreateVisible(false)}
              >
                <Text
                  style={[
                    styles.cancelButtonText,
                    { color: theme.colors.textPrimary },
                  ]}
                >
                  {idID.common.cancel}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Kirim tugas"
                style={[
                  styles.submitButton,
                  { backgroundColor: theme.colors.primary },
                  (!activeProjectId || !prompt.trim() || createTask.isPending) &&
                    styles.submitDisabled,
                ]}
                disabled={
                  !activeProjectId || !prompt.trim() || createTask.isPending
                }
                onPress={() => void submitRuntimeTask()}
              >
                <Text style={styles.submitButtonText}>
                  {createTask.isPending ? 'Mengirim…' : 'Buat tugas'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  segmentedContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  segmentButton: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
  },
  segmentWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  segmentText: {
    fontSize: 14,
  },
  badge: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  tabContent: {
    flex: 1,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
  },
  filterChipsList: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipText: {
    fontSize: 12,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    justifyContent: 'center',
  },
  createBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  taskCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  taskKindText: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 6,
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: '600',
    minWidth: 32,
  },
  taskTime: {
    fontSize: 11,
    marginTop: 4,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalHint: {
    fontSize: 12,
    marginBottom: 12,
  },
  runtimeChoices: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  runtimeChoice: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  runtimeChoiceText: {
    fontSize: 13,
    fontWeight: '700',
  },
  promptInput: {
    minHeight: 90,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    fontSize: 13,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 12,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  submitButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
