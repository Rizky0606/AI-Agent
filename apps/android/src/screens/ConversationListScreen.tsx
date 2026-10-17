import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Plus } from 'lucide-react-native';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useConversations, useCreateConversation, useProjects } from '../hooks/use-queries.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface ConversationListScreenProps {
  onSelectConversation: (conversationId: string, title?: string) => void;
}

export const ConversationListScreen: React.FC<ConversationListScreenProps> = ({
  onSelectConversation,
}) => {
  const theme = useAppTheme();
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
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Workspace filter header */}
      <View
        style={[
          styles.filterSection,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
          allowFontScaling
        >
          Workspace:
        </Text>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[{ id: null, name: 'Semua' }, ...(projects ?? [])]}
          keyExtractor={(item) => item.id ?? 'all'}
          renderItem={({ item }) => {
            const isSelected = activeProjectId === item.id;
            return (
              <Pressable
                android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`Workspace ${item.name}`}
                style={[
                  styles.projectChip,
                  {
                    backgroundColor: isSelected
                      ? theme.colors.primary
                      : theme.colors.surfaceElevated,
                    borderColor: isSelected ? theme.colors.primary : theme.colors.surfaceBorder,
                  },
                ]}
                onPress={() => setActiveProjectId(item.id)}
              >
                <Text
                  style={[
                    styles.projectChipText,
                    {
                      color: isSelected ? '#fff' : theme.colors.textSecondary,
                      fontWeight: isSelected ? '700' : '600',
                    },
                  ]}
                  allowFontScaling
                >
                  {item.name}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {/* Conversations List */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
          <Text
            style={[styles.stateText, { color: theme.colors.textSecondary }]}
            allowFontScaling
          >
            Memuat percakapan…
          </Text>
        </View>
      ) : isError ? (
        <View style={styles.centerContainer}>
          <Text
            style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}
            allowFontScaling
          >
            Percakapan gagal dimuat
          </Text>
          <Text
            style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}
            allowFontScaling
          >
            Periksa koneksi, lalu coba lagi.
          </Text>
          <Pressable
            android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
            accessibilityRole="button"
            style={[styles.createButton, { backgroundColor: theme.colors.primary }]}
            onPress={() => void refetch()}
          >
            <Text style={styles.createButtonText} allowFontScaling>
              Coba lagi
            </Text>
          </Pressable>
        </View>
      ) : conversations?.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text
            style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}
            allowFontScaling
          >
            Belum ada percakapan
          </Text>
          <Text
            style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}
            allowFontScaling
          >
            Mulai percakapan baru. Riwayat tersedia lintas perangkat.
          </Text>
          <Pressable
            android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
            accessibilityRole="button"
            style={[styles.createButton, { backgroundColor: theme.colors.primary }]}
            onPress={handleCreate}
            disabled={createConversation.isPending}
          >
            <Text style={styles.createButtonText} allowFontScaling>
              {createConversation.isPending ? 'Membuat…' : '+ Percakapan baru'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          onRefresh={refetch}
          refreshing={isLoading}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              android_ripple={{ color: 'rgba(128, 128, 128, 0.15)' }}
              accessibilityRole="button"
              accessibilityLabel={`Buka ${item.title || 'percakapan tanpa judul'}`}
              style={[
                styles.convCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.surfaceBorder,
                },
              ]}
              onPress={() => onSelectConversation(item.id, item.title ?? undefined)}
            >
              <View style={styles.convHeader}>
                <Text
                  style={[styles.convTitle, { color: theme.colors.textPrimary }]}
                  numberOfLines={1}
                  allowFontScaling
                >
                  {item.title || 'Percakapan Tanpa Judul'}
                </Text>
                <Text
                  style={[styles.convDate, { color: theme.colors.textMuted }]}
                  allowFontScaling
                >
                  {new Date(item.updatedAt).toLocaleDateString('id-ID')}
                </Text>
              </View>
              <Text
                style={[styles.convPreview, { color: theme.colors.textSecondary }]}
                numberOfLines={1}
                allowFontScaling
              >
                Ketuk untuk membuka obrolan streaming…
              </Text>
            </Pressable>
          )}
        />
      )}

      {conversations && conversations.length > 0 ? (
        <Pressable
          android_ripple={{ color: 'rgba(255, 255, 255, 0.3)', borderless: true }}
          accessibilityRole="button"
          accessibilityLabel="Buat percakapan baru"
          style={[styles.fab, { backgroundColor: theme.colors.primary }]}
          onPress={handleCreate}
          disabled={createConversation.isPending}
        >
          <Plus size={24} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterSection: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginRight: 10,
  },
  projectChip: {
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  projectChipText: {
    fontSize: 12,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  stateText: {
    marginTop: 10,
    fontSize: 13,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  createButton: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    paddingBottom: 80,
  },
  convCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  convHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  convTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  convDate: {
    fontSize: 11,
  },
  convPreview: {
    fontSize: 13,
    lineHeight: 18,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
  },
});
