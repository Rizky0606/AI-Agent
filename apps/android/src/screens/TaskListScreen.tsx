import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useCreateTask, useTasks } from '../hooks/use-queries.ts';
import { createRuntimeTaskRequest } from '../runtime-task.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface TaskListScreenProps {
  onSelectTask: (taskId: string) => void;
}

const STATUS_FILTERS = ['Semua', 'running', 'waiting_approval', 'completed', 'failed'];

export const TaskListScreen: React.FC<TaskListScreenProps> = ({ onSelectTask }) => {
  const theme = useAppTheme();
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
      <View
        style={[
          styles.headerActions,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]} allowFontScaling>
          Daftar Tugas (Tasks)
        </Text>
        <Pressable
          android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
          style={[styles.createButton, { backgroundColor: theme.colors.primary }]}
          onPress={() => {
            setSubmitError(null);
            setCreateVisible(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Buat tugas runtime baru"
        >
          <Text style={styles.createButtonText} allowFontScaling>
            + Tugas Runtime
          </Text>
        </Pressable>
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={STATUS_FILTERS}
        keyExtractor={(item) => item}
        style={styles.filterList}
        contentContainerStyle={styles.filterContainer}
        renderItem={({ item }) => {
          const selected = item === 'Semua' ? !taskStatusFilter : taskStatusFilter === item;
          return (
            <Pressable
              android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
              style={[
                styles.filterChip,
                {
                  backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceElevated,
                  borderColor: selected ? theme.colors.primary : theme.colors.surfaceBorder,
                },
              ]}
              onPress={() => setTaskStatusFilter(item === 'Semua' ? null : item)}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${item}`}
            >
              <Text
                style={[
                  styles.filterText,
                  {
                    color: selected ? '#fff' : theme.colors.textSecondary,
                    fontWeight: selected ? '700' : '600',
                  },
                ]}
                allowFontScaling
              >
                {item === 'Semua' ? item : item.replace('_', ' ').toUpperCase()}
              </Text>
            </Pressable>
          );
        }}
      />

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
              allowFontScaling
            >
              Tugas coding baru
            </Text>
            <Text
              style={[styles.modalHint, { color: theme.colors.textSecondary }]}
              allowFontScaling
            >
              {activeProjectId
                ? `Project: ${activeProjectId}`
                : 'Pilih project di tab Projects terlebih dahulu.'}
            </Text>
            <View style={styles.runtimeChoices}>
              {(['omp', 'hermes'] as const).map((id) => (
                <Pressable
                  key={id}
                  android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
                  style={[
                    styles.runtimeChoice,
                    {
                      backgroundColor:
                        runtime === id ? theme.colors.primary : theme.colors.surfaceElevated,
                      borderColor:
                        runtime === id ? theme.colors.primary : theme.colors.surfaceBorder,
                    },
                  ]}
                  onPress={() => setRuntime(id)}
                >
                  <Text
                    style={[
                      styles.runtimeChoiceText,
                      { color: runtime === id ? '#fff' : theme.colors.textPrimary },
                    ]}
                    allowFontScaling
                  >
                    {id.toUpperCase()}
                  </Text>
                </Pressable>
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
              <Text style={[styles.errorText, { color: theme.colors.danger }]} allowFontScaling>
                {submitError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setCreateVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Batal"
              >
                <Text
                  style={[styles.cancelButtonText, { color: theme.colors.textSecondary }]}
                  allowFontScaling
                >
                  Batal
                </Text>
              </TouchableOpacity>
              <Pressable
                android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
                style={[
                  styles.submitButton,
                  { backgroundColor: theme.colors.primary },
                  (!activeProjectId || !prompt.trim() || createTask.isPending) &&
                    styles.submitDisabled,
                ]}
                disabled={!activeProjectId || !prompt.trim() || createTask.isPending}
                onPress={() => void submitRuntimeTask()}
                accessibilityRole="button"
                accessibilityLabel="Buat tugas"
              >
                <Text style={styles.submitButtonText} allowFontScaling>
                  {createTask.isPending ? 'Mengirim…' : 'Buat tugas'}
                </Text>
              </Pressable>
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
          <Text
            style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}
            allowFontScaling
          >
            Tidak Ada Tugas
          </Text>
          <Text
            style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}
            allowFontScaling
          >
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
            <Pressable
              android_ripple={{ color: 'rgba(128, 128, 128, 0.15)' }}
              style={[
                styles.taskCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.surfaceBorder,
                },
              ]}
              onPress={() => onSelectTask(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Tugas ${item.kind}, status ${item.status}`}
            >
              <View style={styles.cardHeader}>
                <Text
                  style={[styles.taskKind, { color: theme.colors.textPrimary }]}
                  numberOfLines={1}
                  allowFontScaling
                >
                  {item.kind.replace('_', ' ').toUpperCase()}
                </Text>
                <StatusPill status={item.status} />
              </View>

              <View style={styles.progressSection}>
                <View style={styles.progressLabelRow}>
                  <Text
                    style={[styles.progressLabel, { color: theme.colors.textSecondary }]}
                    allowFontScaling
                  >
                    Progres
                  </Text>
                  <Text
                    style={[styles.progressPercent, { color: theme.colors.textPrimary }]}
                    allowFontScaling
                  >
                    {item.progress}%
                  </Text>
                </View>
                <ProgressBar progress={item.progress} />
              </View>

              <View style={styles.cardFooter}>
                <Text
                  style={[styles.dateText, { color: theme.colors.textMuted }]}
                  allowFontScaling
                >
                  Percobaan ke-{item.attempt}/{item.maxAttempts}
                </Text>
                <Text
                  style={[styles.dateText, { color: theme.colors.textMuted }]}
                  allowFontScaling
                >
                  {new Date(item.updatedAt).toLocaleDateString('id-ID')}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  createButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  filterList: {
    maxHeight: 56,
  },
  filterContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  filterChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterText: {
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  modalCard: {
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalHint: {
    fontSize: 13,
  },
  runtimeChoices: {
    flexDirection: 'row',
    gap: 10,
  },
  runtimeChoice: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  runtimeChoiceText: {
    fontWeight: '700',
    fontSize: 13,
  },
  promptInput: {
    minHeight: 100,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
  },
  errorText: {
    fontSize: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelButton: {
    minHeight: 48,
    paddingHorizontal: 16,
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
    fontWeight: '700',
    fontSize: 13,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  taskCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  taskKind: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  progressSection: {
    marginVertical: 4,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  progressLabel: {
    fontSize: 11,
  },
  progressPercent: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  dateText: {
    fontSize: 11,
  },
});
