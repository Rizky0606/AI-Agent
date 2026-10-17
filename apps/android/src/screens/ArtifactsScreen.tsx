import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { defaultApiClient } from '../api/client.ts';
import type { ArtifactItem } from '../api/types.ts';
import { ScreenHeader } from '../components/ScreenHeader.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useUiStore } from '../state/ui-store.ts';

const previewable = (artifact: ArtifactItem): boolean =>
  artifact.mimeType.startsWith('text/') ||
  /json|javascript|typescript|xml|yaml|markdown/.test(artifact.mimeType);

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export interface ArtifactsScreenProps {
  onBack?: () => void;
}

export const ArtifactsScreen: React.FC<ArtifactsScreenProps> = ({ onBack }) => {
  const theme = useAppTheme();
  const { showToast } = useUiStore();
  const [filterType, setFilterType] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; content: string; truncated: boolean } | null>(
    null,
  );

  const loadArtifacts = async () => {
    setLoading(true);
    setError(null);
    try {
      setArtifacts((await defaultApiClient.listArtifacts()).artifacts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat artefak');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadArtifacts();
  }, []);

  const filtered = useMemo(() => {
    if (!filterType) return artifacts;
    return artifacts.filter((artifact) => {
      if (filterType === 'markdown') return artifact.mimeType.includes('markdown');
      if (filterType === 'code')
        return /javascript|typescript|json|sql|python|shell/.test(artifact.mimeType);
      if (filterType === 'report') return artifact.mimeType.includes('pdf');
      return true;
    });
  }, [artifacts, filterType]);

  const openArtifact = async (artifact: ArtifactItem) => {
    if (!previewable(artifact)) {
      showToast('Pratinjau hanya tersedia untuk file teks.');
      return;
    }
    try {
      const result = await defaultApiClient.previewArtifact(artifact.id);
      setPreview({ id: artifact.id, ...result });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Pratinjau tidak tersedia');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title="Manajer Artefak"
        subtitle="Metadata dan pratinjau file hasil tugas AI"
        onBack={onBack}
      />

      <View
        style={[
          styles.filterRow,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        {['Semua', 'markdown', 'code', 'report'].map((filter) => {
          const selected = filter === 'Semua' ? !filterType : filterType === filter;
          return (
            <Pressable
              key={filter}
              android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
              style={[
                styles.chip,
                {
                  backgroundColor: selected
                    ? theme.colors.primary
                    : theme.colors.surfaceElevated,
                  borderColor: selected ? theme.colors.primary : theme.colors.surfaceBorder,
                },
              ]}
              onPress={() => setFilterType(filter === 'Semua' ? null : filter)}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${filter}`}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: selected ? '#fff' : theme.colors.textSecondary,
                    fontWeight: selected ? '700' : '600',
                  },
                ]}
                allowFontScaling
              >
                {filter.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.error, { color: theme.colors.danger }]} allowFontScaling>
            {error}
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => void loadArtifacts()}
            accessibilityRole="button"
            accessibilityLabel="Coba lagi"
          >
            <Text style={[styles.retry, { color: theme.colors.primary }]} allowFontScaling>
              Coba lagi
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.centerContainer}>
              <Text style={[styles.empty, { color: theme.colors.textMuted }]} allowFontScaling>
                Belum ada artefak.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const showingPreview = preview?.id === item.id;
            return (
              <View
                style={[
                  styles.artifactCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.surfaceBorder,
                  },
                ]}
              >
                <View style={styles.cardHeader}>
                  <Text
                    style={[styles.artifactName, { color: theme.colors.textPrimary }]}
                    numberOfLines={1}
                    allowFontScaling
                  >
                    {item.filename}
                  </Text>
                  <View
                    style={[
                      styles.mimePill,
                      {
                        backgroundColor: theme.colors.surfaceElevated,
                        borderColor: theme.colors.surfaceBorder,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.mimePillText, { color: theme.colors.primary }]}
                      allowFontScaling
                    >
                      {item.mimeType.split('/').pop()?.toUpperCase() ?? 'FILE'}
                    </Text>
                  </View>
                </View>

                <Text
                  style={[styles.artifactSize, { color: theme.colors.textMuted }]}
                  allowFontScaling
                >
                  {formatFileSize(item.size)} • {new Date(item.createdAt).toLocaleString('id-ID')}
                </Text>

                {showingPreview ? (
                  <View
                    style={[
                      styles.preview,
                      {
                        backgroundColor: theme.colors.surfaceElevated,
                        borderColor: theme.colors.surfaceBorder,
                      },
                    ]}
                  >
                    <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }}>
                      <Text
                        selectable
                        style={[styles.previewText, { color: theme.colors.textPrimary }]}
                        allowFontScaling
                      >
                        {preview.content}
                        {preview.truncated ? '\n… (pratinjau dipotong)' : ''}
                      </Text>
                    </ScrollView>
                  </View>
                ) : null}

                <View style={styles.actionsRow}>
                  <Pressable
                    android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
                    style={[
                      styles.openBtn,
                      {
                        backgroundColor: showingPreview
                          ? theme.colors.surfaceElevated
                          : theme.colors.primary,
                      },
                    ]}
                    onPress={() => {
                      if (showingPreview) {
                        setPreview(null);
                      } else {
                        void openArtifact(item);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={showingPreview ? 'Tutup pratinjau' : 'Buka pratinjau'}
                  >
                    <Text
                      style={[
                        styles.openBtnText,
                        { color: showingPreview ? theme.colors.textPrimary : '#fff' },
                      ]}
                      allowFontScaling
                    >
                      {showingPreview ? 'Tutup' : 'Pratinjau'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipText: {
    fontSize: 11,
  },
  listContent: {
    padding: 16,
  },
  artifactCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  artifactName: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  mimePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  mimePillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  artifactSize: {
    fontSize: 12,
    marginBottom: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  openBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  openBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  preview: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    marginVertical: 10,
  },
  previewText: {
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  error: {
    fontSize: 13,
    textAlign: 'center',
  },
  retryBtn: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 10,
  },
  retry: {
    fontWeight: '700',
    fontSize: 13,
  },
  empty: {
    textAlign: 'center',
    fontSize: 13,
  },
});
