import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../components/Theme.ts';
import { useUiStore } from '../state/ui-store.ts';
import type { ArtifactItem } from '../api/types.ts';

// Ready interface for future Artifact Manager integration
const SAMPLE_ARTIFACTS: ArtifactItem[] = [
  {
    id: 'art-001',
    name: 'architecture-analysis.md',
    type: 'markdown',
    sizeBytes: 14200,
    url: 'https://storage.local/artifacts/art-001.md',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'art-002',
    name: 'migration-script.sql',
    type: 'code',
    sizeBytes: 3100,
    url: 'https://storage.local/artifacts/art-002.sql',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'art-003',
    name: 'security-audit-report.pdf',
    type: 'report',
    sizeBytes: 450000,
    url: 'https://storage.local/artifacts/art-003.pdf',
    createdAt: new Date().toISOString(),
  },
];

export const ArtifactsScreen: React.FC = () => {
  const { showToast } = useUiStore();
  const [filterType, setFilterType] = useState<string | null>(null);

  const filtered = filterType
    ? SAMPLE_ARTIFACTS.filter((a) => a.type === filterType)
    : SAMPLE_ARTIFACTS;

  const handleOpenArtifact = (artifact: ArtifactItem) => {
    showToast(`Membuka artefak: ${artifact.name}`);
  };

  const handleDownloadArtifact = (artifact: ArtifactItem) => {
    showToast(`Mengunduh artefak: ${artifact.name}`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Manajer Artefak</Text>
        <Text style={styles.headerSubtitle}>Dokumen, kode, dan file hasil eksekusi tugas AI</Text>
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {['Semua', 'markdown', 'code', 'report'].map((ft) => {
          const isSelected = ft === 'Semua' ? !filterType : filterType === ft;
          return (
            <TouchableOpacity
              key={ft}
              style={[styles.chip, isSelected && styles.chipActive]}
              onPress={() => setFilterType(ft === 'Semua' ? null : ft)}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                {ft.toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.artifactCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.artifactIcon}>
                {item.type === 'markdown' ? '📝' : item.type === 'code' ? '💻' : '📊'}
              </Text>
              <View style={styles.artifactMeta}>
                <Text style={styles.artifactName}>{item.name}</Text>
                <Text style={styles.artifactSize}>
                  {item.type.toUpperCase()} • {Math.round((item.sizeBytes ?? 0) / 1024)} KB
                </Text>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.openBtn} onPress={() => handleOpenArtifact(item)}>
                <Text style={styles.openBtnText}>Buka / Pratinjau</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.downloadBtn}
                onPress={() => handleDownloadArtifact(item)}
              >
                <Text style={styles.downloadBtnText}>Unduh File</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
  },
  headerTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceBorder,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceElevated,
    marginRight: theme.spacing.xs,
  },
  chipActive: {
    backgroundColor: theme.colors.primary,
  },
  chipText: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: theme.spacing.md,
  },
  artifactCard: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    marginBottom: theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  artifactIcon: {
    fontSize: 28,
    marginRight: theme.spacing.md,
  },
  artifactMeta: {
    flex: 1,
  },
  artifactName: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  artifactSize: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  openBtn: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.sm,
    marginRight: theme.spacing.sm,
  },
  openBtnText: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  downloadBtn: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.sm,
  },
  downloadBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
