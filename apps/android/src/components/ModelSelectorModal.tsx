import React, { useState, useMemo } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { theme } from './Theme.ts';
import { useChatStore } from '../state/chat-store.ts';
import type { ModelDescriptor } from '../api/types.ts';

export interface ModelSelectorModalProps {
  visible: boolean;
  onClose: () => void;
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  visible,
  onClose,
}) => {
  const {
    models,
    selectedModel,
    setSelectedModel,
    favoriteModels,
    toggleFavoriteModel,
    userDefaultModel,
    setUserDefaultModel,
    modelCatalogUnavailable,
    modelCatalogError,
    loadCatalog,
  } = useChatStore();

  const [search, setSearch] = useState('');

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [models, search]);

  const { favorites, groupedByProvider } = useMemo(() => {
    const favSet = new Set(favoriteModels);
    const favList: ModelDescriptor[] = [];
    const groups: Record<string, ModelDescriptor[]> = {};

    for (const model of filteredModels) {
      if (favSet.has(model.id)) {
        favList.push(model);
      }
      const provider = model.provider || 'Lainnya';
      if (!groups[provider]) groups[provider] = [];
      groups[provider]!.push(model);
    }

    return { favorites: favList, groupedByProvider: groups };
  }, [filteredModels, favoriteModels]);

  const formatContext = (tokens?: number) => {
    if (!tokens) return null;
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
    return `${tokens}`;
  };

  const handleSelect = (modelId: string) => {
    setSelectedModel(modelId);
    onClose();
  };

  const renderBadges = (model: ModelDescriptor) => {
    const details = model.capabilityDetails;
    const isStream =
      details?.streaming?.status === 'probed' ||
      model.capabilities.includes('streaming');
    const isTool =
      details?.tool_calling?.status === 'probed' ||
      model.capabilities.includes('tool_calling');
    const isVision =
      details?.vision?.status === 'probed' ||
      model.capabilities.includes('vision');
    const hasUnknown =
      details &&
      (details.streaming?.status === 'unknown' ||
        details.tool_calling?.status === 'unknown' ||
        details.vision?.status === 'unknown');

    return (
      <View style={styles.badgeRow}>
        {isStream && (
          <View style={[styles.badge, styles.badgeVerified]}>
            <Text style={styles.badgeVerifiedText}>⚡ Stream</Text>
          </View>
        )}
        {isTool && (
          <View style={[styles.badge, styles.badgeVerified]}>
            <Text style={styles.badgeVerifiedText}>🛠 Tools</Text>
          </View>
        )}
        {isVision && (
          <View style={[styles.badge, styles.badgeVerified]}>
            <Text style={styles.badgeVerifiedText}>👁 Vision</Text>
          </View>
        )}
        {hasUnknown && (
          <View style={[styles.badge, styles.badgeUnknown]}>
            <Text style={styles.badgeUnknownText}>? Unknown</Text>
          </View>
        )}
        {model.contextWindow ? (
          <View style={[styles.badge, styles.badgeContext]}>
            <Text style={styles.badgeContextText}>{formatContext(model.contextWindow)}</Text>
          </View>
        ) : null}
        {typeof model.lastLatencyMs === 'number' && model.lastLatencyMs > 0 ? (
          <View style={[styles.badge, styles.badgeLatency]}>
            <Text style={styles.badgeLatencyText}>{model.lastLatencyMs}ms</Text>
          </View>
        ) : null}
      </View>
    );
  };

  const renderModelRow = (model: ModelDescriptor) => {
    const isSelected = selectedModel === model.id;
    const isFav = favoriteModels.includes(model.id);
    const isDefault = userDefaultModel === model.id || model.isDefault;

    return (
      <TouchableOpacity
        key={model.id}
        accessibilityRole="button"
        accessibilityLabel={`Pilih model ${model.id}`}
        style={[styles.modelRow, isSelected && styles.modelRowSelected]}
        onPress={() => handleSelect(model.id)}
      >
        <View style={styles.modelInfo}>
          <View style={styles.modelHeaderRow}>
            <Text style={styles.modelName} numberOfLines={1}>
              {model.id}
            </Text>
            {isDefault && (
              <View style={styles.defaultBadge}>
                <Text style={styles.defaultBadgeText}>Default</Text>
              </View>
            )}
          </View>
          {renderBadges(model)}
        </View>

        <View style={styles.modelActions}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={isFav ? 'Hapus favorit' : 'Sematkan favorit'}
            style={styles.actionBtnTouch}
            onPress={() => toggleFavoriteModel(model.id)}
          >
            <Text style={[styles.favStar, isFav && styles.favStarActive]}>
              {isFav ? '★' : '☆'}
            </Text>
          </TouchableOpacity>

          {!isDefault && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Jadikan ${model.id} default`}
              style={styles.setDefaultTouch}
              onPress={() => void setUserDefaultModel(model.id)}
            >
              <Text style={styles.setDefaultText}>Set Default</Text>
            </TouchableOpacity>
          )}

          {isSelected && <Text style={styles.checkMark}>✓</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.scrim} />
        </TouchableWithoutFeedback>

        <View style={styles.sheetContainer}>
          {/* Drag Handle */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Pilih Model AI</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Tutup dialog"
              style={styles.closeBtn}
              onPress={onClose}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Search Box */}
          <View style={styles.searchBox}>
            <TextInput
              accessibilityLabel="Cari model"
              style={styles.searchInput}
              placeholder="Cari model atau provider..."
              placeholderTextColor={theme.colors.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            {search ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Hapus pencarian"
                style={styles.clearSearchBtn}
                onPress={() => setSearch('')}
              >
                <Text style={styles.clearSearchText}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Catalog Error Banner */}
          {modelCatalogUnavailable && (
            <View style={styles.catalogAlert}>
              <Text style={styles.catalogAlertText}>
                {modelCatalogError || 'Katalog model tidak dapat dihubungi (503).'}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Coba lagi memuat katalog"
                style={styles.retryBtn}
                onPress={() => void loadCatalog()}
              >
                <Text style={styles.retryBtnText}>Coba lagi</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Content Scroll */}
          <ScrollView style={styles.scrollList} contentContainerStyle={styles.scrollContent}>
            {/* Auto (Direkomendasikan) */}
            {(!search || 'auto'.includes(search.toLowerCase()) || 'disarankan'.includes(search.toLowerCase())) && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Pilih mode Auto"
                style={[styles.modelRow, styles.autoRow, selectedModel === 'auto' && styles.modelRowSelected]}
                onPress={() => handleSelect('auto')}
              >
                <View style={styles.modelInfo}>
                  <View style={styles.modelHeaderRow}>
                    <Text style={styles.autoTitle}>✦ Auto (Direkomendasikan)</Text>
                    <View style={styles.recommendedBadge}>
                      <Text style={styles.recommendedBadgeText}>Disarankan</Text>
                    </View>
                  </View>
                  <Text style={styles.autoSubtitle}>
                    Model optimal dipilih otomatis sesuai mode & konteks tugas.
                  </Text>
                </View>
                {selectedModel === 'auto' && <Text style={styles.checkMark}>✓</Text>}
              </TouchableOpacity>
            )}

            {/* Favorit Section */}
            {favorites.length > 0 && (
              <View style={styles.sectionContainer}>
                <Text style={styles.sectionTitle}>★ FAVORIT DIENYEMATKAN</Text>
                {favorites.map((m) => renderModelRow(m))}
              </View>
            )}

            {/* Provider Groups */}
            {Object.keys(groupedByProvider).map((provider) => {
              const list = groupedByProvider[provider]!;
              if (list.length === 0) return null;
              return (
                <View key={provider} style={styles.sectionContainer}>
                  <Text style={styles.sectionTitle}>{provider.toUpperCase()} ({list.length})</Text>
                  {list.map((m) => renderModelRow(m))}
                </View>
              );
            })}

            {filteredModels.length === 0 && search ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Tidak ada model yang cocok dengan &quot;{search}&quot;</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer Info */}
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>{models.length} model tersedia</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Segarkan katalog model"
              style={styles.refreshTouch}
              onPress={() => void loadCatalog()}
            >
              <Text style={styles.refreshText}>Segarkan</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  scrim: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    paddingBottom: 20,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surfaceBorder,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceBorder,
  },
  headerTitle: {
    color: theme.colors.textPrimary,
    ...theme.typography.title,
    fontWeight: '700',
  },
  closeBtn: {
    width: theme.controls.minTouchTarget,
    height: theme.controls.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: theme.colors.textSecondary,
    fontSize: 18,
    fontWeight: '600',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    marginHorizontal: theme.spacing.md,
    marginVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    minHeight: theme.controls.minTouchTarget,
    paddingHorizontal: theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 14,
    paddingVertical: 8,
  },
  clearSearchBtn: {
    width: theme.controls.minTouchTarget,
    height: theme.controls.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearSearchText: {
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  catalogAlert: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: theme.borderRadius.sm,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  catalogAlertText: {
    color: theme.colors.warning,
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  retryBtn: {
    minHeight: theme.controls.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  retryBtnText: {
    color: theme.colors.warning,
    fontWeight: '700',
    fontSize: 12,
  },
  scrollList: {
    maxHeight: 400,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: theme.controls.minTouchTarget,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 6,
    backgroundColor: theme.colors.surfaceElevated,
  },
  modelRowSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
  },
  autoRow: {
    backgroundColor: 'rgba(6, 182, 212, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.25)',
  },
  modelInfo: {
    flex: 1,
    marginRight: 8,
  },
  modelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  modelName: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  autoTitle: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  autoSubtitle: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  recommendedBadge: {
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
  },
  recommendedBadgeText: {
    color: '#06b6d4',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  defaultBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: theme.borderRadius.sm,
  },
  defaultBadgeText: {
    color: theme.colors.primary,
    fontSize: 9,
    fontWeight: '600',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeVerified: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  badgeVerifiedText: {
    color: '#10b981',
    fontSize: 9,
    fontWeight: '600',
  },
  badgeUnknown: {
    backgroundColor: 'rgba(156, 163, 175, 0.15)',
  },
  badgeUnknownText: {
    color: theme.colors.textMuted,
    fontSize: 9,
  },
  badgeContext: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
  },
  badgeContextText: {
    color: '#a855f7',
    fontSize: 9,
    fontWeight: '600',
  },
  badgeLatency: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  badgeLatencyText: {
    color: theme.colors.primary,
    fontSize: 9,
  },
  modelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionBtnTouch: {
    width: theme.controls.minTouchTarget,
    height: theme.controls.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  favStar: {
    fontSize: 18,
    color: theme.colors.textMuted,
  },
  favStarActive: {
    color: '#f59e0b',
  },
  setDefaultTouch: {
    minHeight: theme.controls.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  setDefaultText: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: theme.borderRadius.sm,
  },
  checkMark: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 4,
  },
  sectionContainer: {
    marginTop: 12,
  },
  sectionTitle: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  emptyContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.surfaceBorder,
  },
  footerText: {
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  refreshTouch: {
    minHeight: theme.controls.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  refreshText: {
    color: theme.colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
});
