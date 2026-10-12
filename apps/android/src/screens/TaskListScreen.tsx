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
import { ProgressBar } from '../components/ProgressBar.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { theme } from '../components/Theme.ts';
import { useCreateTask, useTasks } from '../hooks/use-queries.ts';
import { createRuntimeTaskRequest } from '../runtime-task.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface TaskListScreenProps {
  onSelectTask: (taskId: string) => void;
}

const STATUS_FILTERS = ['Semua', 'running', 'waiting_approval', 'completed', 'failed'];

export const TaskListScreen: React.FC<TaskListScreenProps> = ({ onSelectTask }) => {
  const { activeProjectId, taskStatusFilter, setTaskStatusFilter } = useUiStore();

  const activeFilter = taskStatusFilter ?? undefined;
  const {
    data: tasks,
    isLoading,
    refetch,
  } = useTasks({
    projectId: activeProjectId ?? undefined,
    status: activeFilter,
  });
  const createTask = useCreateTask();
  const [createVisible, setCreateVisible] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [runtime, setRuntime] = useState<'omp' | 'hermes'>('omp');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitRuntimeTask = async () => {
    const instruction = prompt.trim();
    if (!activeProjectId) { setSubmitError('Pilih project terlebih dahulu.'); return; }
    if (!instruction) { setSubmitError('Masukkan instruksi tugas.'); return; }
    setSubmitError(null);
    try {
      const request = createRuntimeTaskRequest(activeProjectId, instruction, runtime, `${activeProjectId}/${Date.now()}`);
      const { task } = await createTask.mutateAsync(request);
      setPrompt('');
      setCreateVisible(false);
      onSelectTask(task.id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Tugas gagal dibuat.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerActions}>
        <Text style={styles.headerTitle}>Daftar Tugas (Tasks)</Text>
        <TouchableOpacity style={styles.createButton} onPress={() => { setSubmitError(null); setCreateVisible(true); }}>
          <Text style={styles.createButtonText}>+ Tugas Runtime</Text>
        </TouchableOpacity>
      </View>
      <FlatList horizontal showsHorizontalScrollIndicator={false} data={STATUS_FILTERS} keyExtractor={(item) => item} style={styles.filterList} renderItem={({ item }) => {
        const selected = item === 'Semua' ? !taskStatusFilter : taskStatusFilter === item;
        return <TouchableOpacity style={[styles.filterChip, selected && styles.filterChipActive]} onPress={() => setTaskStatusFilter(item === 'Semua' ? null : item)}><Text style={[styles.filterText, selected && styles.filterTextActive]}>{item === 'Semua' ? item : item.replace('_', ' ').toUpperCase()}</Text></TouchableOpacity>;
      }} />
      <Modal visible={createVisible} transparent animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tugas coding baru</Text>
            <Text style={styles.modalHint}>{activeProjectId ? `Project: ${activeProjectId}` : 'Pilih project di tab Projects terlebih dahulu.'}</Text>
            <View style={styles.runtimeChoices}>
              {(['omp', 'hermes'] as const).map((id) => (
                <TouchableOpacity key={id} style={[styles.runtimeChoice, runtime === id && styles.runtimeChoiceSelected]} onPress={() => setRuntime(id)}>
                  <Text style={[styles.runtimeChoiceText, runtime === id && styles.runtimeChoiceTextSelected]}>{id.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.promptInput} value={prompt} onChangeText={setPrompt} placeholder="Instruksi untuk runtime..." multiline textAlignVertical="top" accessibilityLabel="Instruksi tugas runtime" />
            {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setCreateVisible(false)}><Text style={styles.cancelButtonText}>Batal</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.submitButton, (!activeProjectId || !prompt.trim() || createTask.isPending) && styles.submitDisabled]} disabled={!activeProjectId || !prompt.trim() || createTask.isPending} onPress={() => void submitRuntimeTask()}>
                <Text style={styles.submitButtonText}>{createTask.isPending ? 'Mengirim…' : 'Buat tugas'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
        </View>
      ) : tasks?.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyTitle}>Tidak Ada Tugas</Text>
          <Text style={styles.emptySubtitle}>
            Tugas yang dieksekusi oleh asisten AI akan tampil di sini
          </Text>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          onRefresh={refetch}
          refreshing={isLoading}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.taskCard} onPress={() => onSelectTask(item.id)}>
              <View style={styles.cardHeader}>
                <Text style={styles.taskKind} numberOfLines={1}>
                  {item.kind.replace('_', ' ').toUpperCase()}
                </Text>
                <StatusPill status={item.status} />
              </View>

              <View style={styles.progressSection}>
                <View style={styles.progressLabelRow}>
                  <Text style={styles.progressLabel}>Progres</Text>
                  <Text style={styles.progressPercent}>{item.progress}%</Text>
                </View>
                <ProgressBar progress={item.progress} />
              </View>

              <View style={styles.cardFooter}>
                <Text style={styles.dateText}>
                  Percobaan ke-{item.attempt}/{item.maxAttempts}
                </Text>
                <Text style={styles.dateText}>
                  {new Date(item.updatedAt).toLocaleDateString('id-ID')}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md, backgroundColor: theme.colors.surface },
  createButton: { backgroundColor: theme.colors.primary, borderRadius: theme.borderRadius.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  createButtonText: { color: '#fff', fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: theme.spacing.lg, backgroundColor: 'rgba(0,0,0,0.65)' },
  modalCard: { backgroundColor: theme.colors.surface, padding: theme.spacing.lg, borderRadius: theme.borderRadius.lg, gap: theme.spacing.md },
  modalTitle: { color: theme.colors.textPrimary, fontSize: 20, fontWeight: '700' },
  modalHint: { color: theme.colors.textSecondary, fontSize: 13 },
  runtimeChoices: { flexDirection: 'row', gap: theme.spacing.sm },
  runtimeChoice: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.surfaceElevated },
  runtimeChoiceSelected: { backgroundColor: theme.colors.primary },
  runtimeChoiceText: { color: theme.colors.textSecondary, fontWeight: '700' },
  runtimeChoiceTextSelected: { color: '#fff' },
  promptInput: { minHeight: 120, borderWidth: 1, borderColor: theme.colors.surfaceBorder, borderRadius: theme.borderRadius.md, padding: theme.spacing.md, color: theme.colors.textPrimary },
  errorText: { color: theme.colors.danger, fontSize: 13 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.sm },
  cancelButton: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  cancelButtonText: { color: theme.colors.textSecondary },
  submitButton: { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.borderRadius.md },
  submitDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#fff', fontWeight: '700' },
  header: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceBorder,
  },
  headerTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: theme.spacing.sm,
  },
  filterList: {
    marginTop: theme.spacing.xs,
  },
  filterChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceElevated,
    marginRight: theme.spacing.xs,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
  },
  filterText: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  emptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  emptySubtitle: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  listContent: {
    padding: theme.spacing.md,
  },
  taskCard: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    marginBottom: theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  taskKind: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  progressSection: {
    marginVertical: theme.spacing.xs,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  progressLabel: {
    color: theme.colors.textSecondary,
    fontSize: 11,
  },
  progressPercent: {
    color: theme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.sm,
  },
  dateText: {
    color: theme.colors.textMuted,
    fontSize: 11,
  },
});
