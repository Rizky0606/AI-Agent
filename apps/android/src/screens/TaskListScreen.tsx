import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { theme } from '../components/Theme.ts';
import { useTasks } from '../hooks/use-queries.ts';
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

  return (
    <View style={styles.container}>
      {/* Header and status filter pills */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Daftar Tugas (Tasks)</Text>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={STATUS_FILTERS}
          keyExtractor={(item) => item}
          style={styles.filterList}
          renderItem={({ item }) => {
            const isSelected = item === 'Semua' ? !taskStatusFilter : taskStatusFilter === item;
            return (
              <TouchableOpacity
                style={[styles.filterChip, isSelected && styles.filterChipActive]}
                onPress={() => setTaskStatusFilter(item === 'Semua' ? null : item)}
              >
                <Text style={[styles.filterText, isSelected && styles.filterTextActive]}>
                  {item === 'Semua' ? 'Semua' : item.replace('_', ' ').toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

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
