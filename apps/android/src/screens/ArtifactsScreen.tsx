import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { defaultApiClient } from '../api/client.ts';
import type { ArtifactItem } from '../api/types.ts';
import { theme } from '../components/Theme.ts';
import { useUiStore } from '../state/ui-store.ts';

const previewable = (artifact: ArtifactItem): boolean =>
  artifact.mimeType.startsWith('text/') || /json|javascript|typescript|xml|yaml|markdown/.test(artifact.mimeType);

export const ArtifactsScreen: React.FC = () => {
  const { showToast } = useUiStore();
  const [filterType, setFilterType] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; content: string; truncated: boolean } | null>(null);

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

  useEffect(() => { void loadArtifacts(); }, []);

  const filtered = useMemo(() => {
    if (!filterType) return artifacts;
    return artifacts.filter((artifact) => {
      if (filterType === 'markdown') return artifact.mimeType.includes('markdown');
      if (filterType === 'code') return /javascript|typescript|json|sql|python|shell/.test(artifact.mimeType);
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Manajer Artefak</Text>
        <Text style={styles.headerSubtitle}>Metadata dan pratinjau file hasil tugas AI</Text>
      </View>
      <View style={styles.filterRow}>
        {['Semua', 'markdown', 'code', 'report'].map((filter) => {
          const selected = filter === 'Semua' ? !filterType : filterType === filter;
          return <TouchableOpacity key={filter} style={[styles.chip, selected && styles.chipActive]} onPress={() => setFilterType(filter === 'Semua' ? null : filter)}><Text style={[styles.chipText, selected && styles.chipTextActive]}>{filter.toUpperCase()}</Text></TouchableOpacity>;
        })}
      </View>
      {loading ? <ActivityIndicator style={styles.state} color={theme.colors.primary} /> : error ? <View style={styles.state}><Text style={styles.error}>{error}</Text><TouchableOpacity onPress={() => void loadArtifacts()}><Text style={styles.retry}>Coba lagi</Text></TouchableOpacity></View> : <FlatList data={filtered} keyExtractor={(item) => item.id} contentContainerStyle={styles.listContent} ListEmptyComponent={<Text style={styles.empty}>Belum ada artefak.</Text>} renderItem={({ item }) => {
        const showingPreview = preview?.id === item.id;
        return <View style={styles.artifactCard}>
          <Text style={styles.artifactName}>{item.filename}</Text>
          <Text style={styles.artifactSize}>{item.mimeType} • {Math.ceil(item.size / 1024)} KB • {new Date(item.createdAt).toLocaleString()}</Text>
          {showingPreview && <View style={styles.preview}><Text style={styles.previewText}>{preview.content}{preview.truncated ? '\n… (pratinjau dipotong)' : ''}</Text></View>}
          <View style={styles.actionsRow}><TouchableOpacity style={styles.openBtn} onPress={() => void openArtifact(item)}><Text style={styles.openBtnText}>{showingPreview ? 'Tutup' : 'Pratinjau'}</Text></TouchableOpacity><TouchableOpacity style={styles.downloadBtn} onPress={() => showToast('Unduhan belum tersedia; gunakan pratinjau metadata.')}><Text style={styles.downloadBtnText}>Unduh tidak tersedia</Text></TouchableOpacity></View>
        </View>;
      }} />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.sm, backgroundColor: theme.colors.surface },
  headerTitle: { color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700' },
  headerSubtitle: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  filterRow: { flexDirection: 'row', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.surfaceBorder },
  chip: { paddingHorizontal: theme.spacing.md, paddingVertical: 4, borderRadius: theme.borderRadius.full, backgroundColor: theme.colors.surfaceElevated, marginRight: theme.spacing.xs },
  chipActive: { backgroundColor: theme.colors.primary },
  chipText: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  listContent: { padding: theme.spacing.md },
  artifactCard: { backgroundColor: theme.colors.surface, padding: theme.spacing.md, borderRadius: theme.borderRadius.md, borderWidth: 1, borderColor: theme.colors.surfaceBorder, marginBottom: theme.spacing.md },
  artifactName: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700' },
  artifactSize: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4 },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.spacing.md },
  openBtn: { backgroundColor: theme.colors.surfaceElevated, paddingHorizontal: theme.spacing.md, paddingVertical: 8, borderRadius: theme.borderRadius.sm, marginRight: theme.spacing.xs },
  error: { color: theme.colors.danger, textAlign: 'center' },
  openBtnText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  downloadBtn: { backgroundColor: theme.colors.surfaceElevated, paddingHorizontal: theme.spacing.md, paddingVertical: 8, borderRadius: theme.borderRadius.sm },
  downloadBtnText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  preview: { backgroundColor: theme.colors.background, borderRadius: theme.borderRadius.sm, padding: theme.spacing.sm, marginTop: theme.spacing.sm, maxHeight: 220 },
  previewText: { color: theme.colors.textPrimary, fontSize: 11, fontFamily: 'monospace' },
  state: { margin: theme.spacing.lg, alignItems: 'center' },
  retry: { color: theme.colors.primary, fontWeight: '700', marginTop: theme.spacing.sm },
  empty: { color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing.lg },
});
