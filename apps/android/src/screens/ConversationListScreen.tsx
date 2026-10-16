import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { theme } from '../components/Theme.ts';
import { useConversations, useCreateConversation, useProjects } from '../hooks/use-queries.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface ConversationListScreenProps {
  onSelectConversation: (conversationId: string, title?: string) => void;
}

export const ConversationListScreen: React.FC<ConversationListScreenProps> = ({
  onSelectConversation,
}) => {
  const { activeProjectId, setActiveProjectId } = useUiStore();
  const { data: projects } = useProjects();
  const {
    data: conversations,
    isLoading,
    isError,
    refetch,
  } = useConversations(activeProjectId ?? undefined);
  const createConversation = useCreateConversation();

  const handleCreate = async () => {
    if (createConversation.isPending) return;
    try {
      const newConv = await createConversation.mutateAsync({
        projectId: activeProjectId ?? undefined,
        title: `Percakapan ${new Date().toLocaleDateString('id-ID')}`,
      });
      onSelectConversation(newConv.id, newConv.title ?? undefined);
    } catch {
      useUiStore.getState().showToast('Percakapan baru gagal dibuat');
    }
  };

  return (
    <View style={styles.container}>
      {/* Workspace filter header */}
      <View style={styles.filterSection}>
        <Text style={styles.sectionTitle}>Workspace:</Text>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[{ id: null, name: 'Semua' }, ...(projects ?? [])]}
          keyExtractor={(item) => item.id ?? 'all'}
          renderItem={({ item }) => {
            const isSelected = activeProjectId === item.id;
            return (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`Workspace ${item.name}`}
                style={[styles.projectChip, isSelected && styles.projectChipSelected]}
                onPress={() => setActiveProjectId(item.id)}
              >
                <Text style={[styles.projectChipText, isSelected && styles.projectChipTextSelected]}>{item.name}</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Conversations List */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
          <Text style={styles.stateText}>Memuat percakapan…</Text>
        </View>
      ) : isError ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyTitle}>Percakapan gagal dimuat</Text>
          <Text style={styles.emptySubtitle}>Periksa koneksi, lalu coba lagi.</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.createButton} onPress={() => void refetch()}><Text style={styles.createButtonText}>Coba lagi</Text></TouchableOpacity>
        </View>
      ) : conversations?.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyMark}>✦</Text>
          <Text style={styles.emptyTitle}>Belum ada percakapan</Text>
          <Text style={styles.emptySubtitle}>Mulai percakapan baru. Riwayat tersedia lintas perangkat.</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.createButton} onPress={handleCreate} disabled={createConversation.isPending}><Text style={styles.createButtonText}>{createConversation.isPending ? 'Membuat…' : '+ Percakapan baru'}</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          onRefresh={refetch}
          refreshing={isLoading}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Buka ${item.title || 'percakapan tanpa judul'}`} style={styles.convCard} onPress={() => onSelectConversation(item.id, item.title ?? undefined)}>
              <View style={styles.convHeader}><Text style={styles.convTitle} numberOfLines={1}>{item.title || 'Percakapan Tanpa Judul'}</Text><Text style={styles.convDate}>{new Date(item.updatedAt).toLocaleDateString('id-ID')}</Text></View>
              <Text style={styles.convPreview} numberOfLines={1}>Ketuk untuk membuka obrolan streaming…</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {conversations && conversations.length > 0 ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Buat percakapan baru" style={styles.fab} onPress={handleCreate} disabled={createConversation.isPending}>
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      ) : null}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  filterSection: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceBorder,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginRight: theme.spacing.sm,
  },
  projectChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceElevated,
    marginRight: theme.spacing.xs,
  },
  projectChipSelected: {
    backgroundColor: theme.colors.primary,
  },
  projectChipText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  projectChipTextSelected: {
    color: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  stateText: { color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.sm },
  emptyMark: { color: theme.colors.primary, fontSize: 32, marginBottom: theme.spacing.sm },
  emptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  emptySubtitle: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  createButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.sm,
  },
  createButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  listContent: {
    padding: theme.spacing.md,
  },
  convCard: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    marginBottom: theme.spacing.sm,
  },
  convHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  convTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  convDate: {
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  convPreview: {
    color: theme.colors.textSecondary,
    fontSize: 13,
  },
  fab: {
    position: 'absolute',
    bottom: theme.spacing.xl,
    right: theme.spacing.xl,
    width: theme.controls.minTouchTarget,
    height: theme.controls.minTouchTarget,
    borderRadius: theme.controls.minTouchTarget / 2,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  fabText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '400',
    marginTop: -2,
  },
});
