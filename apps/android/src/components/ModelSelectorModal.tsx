import React, { useState, useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Eye, Star, Wrench, X, Zap } from 'lucide-react-native';
import { useAppTheme } from '../hooks/use-theme.ts';
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
  const theme = useAppTheme();
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
            <Zap size={10} color="#10b981" />
            <Text style={styles.badgeVerifiedText} allowFontScaling>
              Stream
            </Text>
          </View>
        )}
        {isTool && (
          <View style={[styles.badge, styles.badgeVerified]}>
            <Wrench size={10} color="#10b981" />
            <Text style={styles.badgeVerifiedText} allowFontScaling>
              Tools
            </Text>
          </View>
        )}
        {isVision && (
          <View style={[styles.badge, styles.badgeVerified]}>
            <Eye size={10} color="#10b981" />
            <Text style={styles.badgeVerifiedText} allowFontScaling>
              Vision
            </Text>
          </View>
        )}
        {hasUnknown && (
          <View style={[styles.badge, styles.badgeUnknown]}>
            <Text style={styles.badgeUnknownText} allowFontScaling>
              ? Unknown
            </Text>
          </View>
        )}
        {model.contextWindow ? (
          <View style={[styles.badge, styles.badgeContext]}>
            <Text style={styles.badgeContextText} allowFontScaling>
              {formatContext(model.contextWindow)}
            </Text>
          </View>
        ) : null}
        {typeof model.lastLatencyMs === 'number' && model.lastLatencyMs > 0 ? (
          <View style={[styles.badge, styles.badgeLatency]}>
            <Text style={styles.badgeLatencyText} allowFontScaling>
              {model.lastLatencyMs}ms
            </Text>
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
      <Pressable
        key={model.id}
        android_ripple={{ color: 'rgba(128, 128, 128, 0.15)' }}
        accessibilityRole="button"
        accessibilityLabel={`Pilih model ${model.id}`}
        style={[
          styles.modelRow,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: isSelected ? theme.colors.primary : 'transparent',
          },
          isSelected && {
            backgroundColor: theme.scheme === 'dark' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.08)',
          },
        ]}
        onPress={() => handleSelect(model.id)}
      >
        <View style={styles.modelInfo}>
          <View style={styles.modelHeaderRow}>
            <Text
              style={[styles.modelName, { color: theme.colors.textPrimary }]}
              numberOfLines={1}
              allowFontScaling
            >
              {model.id}
            </Text>
            {isDefault && (
              <View style={[styles.defaultBadge, { backgroundColor: theme.colors.surfaceBorder }]}>
                <Text style={[styles.defaultBadgeText, { color: theme.colors.primary }]} allowFontScaling>
                  Default
                </Text>
              </View>
            )}
          </View>
          {renderBadges(model)}
        </View>

        <View style={styles.modelActions}>
          <Pressable
            android_ripple={{ color: 'rgba(128, 128, 128, 0.2)', borderless: true }}
            accessibilityRole="button"
            accessibilityLabel={isFav ? 'Hapus favorit' : 'Sematkan favorit'}
            style={styles.actionBtnTouch}
            onPress={() => toggleFavoriteModel(model.id)}
          >
            <Star
              size={18}
              color={isFav ? '#f59e0b' : theme.colors.textMuted}
              fill={isFav ? '#f59e0b' : 'transparent'}
            />
          </Pressable>

          {!isDefault && (
            <Pressable
              android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
              accessibilityRole="button"
              accessibilityLabel={`Jadikan ${model.id} default`}
              style={[
                styles.setDefaultTouch,
                { borderColor: theme.colors.surfaceBorder },
              ]}
              onPress={() => void setUserDefaultModel(model.id)}
            >
              <Text
                style={[styles.setDefaultText, { color: theme.colors.textSecondary }]}
                allowFontScaling
              >
                Set Default
              </Text>
            </Pressable>
          )}

          {isSelected && (
            <Text style={[styles.checkMark, { color: theme.colors.primary }]} allowFontScaling>
              ✓
            </Text>
          )}
        </View>
      </Pressable>
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

        <View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          {/* Drag Handle */}
          <View
            style={[styles.handleBar, { backgroundColor: theme.colors.surfaceBorder }]}
          />

          {/* Header */}
          <View
            style={[styles.headerRow, { borderBottomColor: theme.colors.surfaceBorder }]}
          >
            <Text
              style={[styles.headerTitle, { color: theme.colors.textPrimary }]}
              allowFontScaling
            >
              Pilih Model AI
            </Text>
            <Pressable
              android_ripple={{ color: 'rgba(128, 128, 128, 0.2)', borderless: true }}
              accessibilityRole="button"
              accessibilityLabel="Tutup dialog"
              style={styles.closeBtn}
              onPress={onClose}
            >
              <X size={20} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          {/* Search Box */}
          <View
            style={[
              styles.searchBox,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            <TextInput
              accessibilityLabel="Cari model"
              style={[styles.searchInput, { color: theme.colors.textPrimary }]}
              placeholder="Cari model atau provider..."
              placeholderTextColor={theme.colors.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            {search ? (
              <Pressable
                android_ripple={{ color: 'rgba(128, 128, 128, 0.2)', borderless: true }}
                accessibilityRole="button"
                accessibilityLabel="Hapus pencarian"
                style={styles.clearSearchBtn}
                onPress={() => setSearch('')}
              >
                <X size={16} color={theme.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {/* Catalog Error Banner */}
          {modelCatalogUnavailable && (
            <View
              style={[
                styles.catalogAlert,
                {
                  backgroundColor: theme.colors.riskMediumBg,
                  borderColor: theme.colors.riskMedium,
                },
              ]}
            >
              <Text
                style={[styles.catalogAlertText, { color: theme.colors.riskMedium }]}
                allowFontScaling
              >
                {modelCatalogError || 'Katalog model tidak dapat dihubungi (503).'}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Coba lagi memuat katalog"
                style={styles.retryBtn}
                onPress={() => void loadCatalog()}
              >
                <Text
                  style={[styles.retryBtnText, { color: theme.colors.riskMedium }]}
                  allowFontScaling
                >
                  Coba lagi
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Content Scroll */}
          <ScrollView
            style={styles.scrollList}
            contentContainerStyle={styles.scrollContent}
            nestedScrollEnabled
          >
            {/* Auto (Direkomendasikan) */}
            {(!search ||
              'auto'.includes(search.toLowerCase()) ||
              'disarankan'.includes(search.toLowerCase())) && (
              <Pressable
                android_ripple={{ color: 'rgba(59, 130, 246, 0.15)' }}
                accessibilityRole="button"
                accessibilityLabel="Pilih mode Auto"
                style={[
                  styles.modelRow,
                  styles.autoRow,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor:
                      selectedModel === 'auto' ? theme.colors.primary : theme.colors.surfaceBorder,
                  },
                ]}
                onPress={() => handleSelect('auto')}
              >
                <View style={styles.modelInfo}>
                  <View style={styles.modelHeaderRow}>
                    <Text
                      style={[styles.autoTitle, { color: theme.colors.primary }]}
                      allowFontScaling
                    >
                      ✦ Auto (Direkomendasikan)
                    </Text>
                    <View
                      style={[
                        styles.recommendedBadge,
                        { backgroundColor: theme.colors.primary },
                      ]}
                    >
                      <Text style={styles.recommendedBadgeText} allowFontScaling>
                        Disarankan
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[styles.autoSubtitle, { color: theme.colors.textSecondary }]}
                    allowFontScaling
                  >
                    Model optimal dipilih otomatis sesuai mode & konteks tugas.
                  </Text>
                </View>
                {selectedModel === 'auto' && (
                  <Text style={[styles.checkMark, { color: theme.colors.primary }]} allowFontScaling>
                    ✓
                  </Text>
                )}
              </Pressable>
            )}

            {/* Favorit Section */}
            {favorites.length > 0 && (
              <View style={styles.sectionContainer}>
                <Text
                  style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
                  allowFontScaling
                >
                  ★ FAVORIT DIENYEMATKAN
                </Text>
                {favorites.map((m) => renderModelRow(m))}
              </View>
            )}

            {/* Provider Groups */}
            {Object.keys(groupedByProvider).map((provider) => {
              const list = groupedByProvider[provider]!;
              if (list.length === 0) return null;
              return (
                <View key={provider} style={styles.sectionContainer}>
                  <Text
                    style={[styles.sectionTitle, { color: theme.colors.textMuted }]}
                    allowFontScaling
                  >
                    {provider.toUpperCase()} ({list.length})
                  </Text>
                  {list.map((m) => renderModelRow(m))}
                </View>
              );
            })}

            {filteredModels.length === 0 && search ? (
              <View style={styles.emptyContainer}>
                <Text
                  style={[styles.emptyText, { color: theme.colors.textMuted }]}
                  allowFontScaling
                >
                  Tidak ada model yang cocok dengan &quot;{search}&quot;
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer Info */}
          <View
            style={[styles.footerRow, { borderTopColor: theme.colors.surfaceBorder }]}
          >
            <Text
              style={[styles.footerText, { color: theme.colors.textMuted }]}
              allowFontScaling
            >
              {models.length} model tersedia
            </Text>
            <Pressable
              android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
              accessibilityRole="button"
              accessibilityLabel="Segarkan katalog model"
              style={styles.refreshTouch}
              onPress={() => void loadCatalog()}
            >
              <Text
                style={[styles.refreshText, { color: theme.colors.primary }]}
                allowFontScaling
              >
                Segarkan
              </Text>
            </Pressable>
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    borderWidth: 1,
    paddingBottom: 20,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  clearSearchBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  catalogAlert: {
    borderWidth: 1,
    borderRadius: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  catalogAlertText: {
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  retryBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  retryBtnText: {
    fontWeight: '700',
    fontSize: 12,
  },
  scrollList: {
    maxHeight: 400,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  autoRow: {
    borderWidth: 1,
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
    fontSize: 13,
    fontWeight: '600',
  },
  autoTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  autoSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  recommendedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  recommendedBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  defaultBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  defaultBadgeText: {
    fontSize: 9,
    fontWeight: '600',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeVerified: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  badgeVerifiedText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '600',
  },
  badgeUnknown: {
    backgroundColor: 'rgba(156, 163, 175, 0.15)',
  },
  badgeUnknownText: {
    color: '#9ca3af',
    fontSize: 10,
  },
  badgeContext: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
  },
  badgeContextText: {
    color: '#a855f7',
    fontSize: 10,
    fontWeight: '600',
  },
  badgeLatency: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  badgeLatencyText: {
    color: '#3b82f6',
    fontSize: 10,
  },
  modelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBtnTouch: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  setDefaultTouch: {
    minHeight: 40,
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  setDefaultText: {
    fontSize: 10,
    fontWeight: '600',
  },
  checkMark: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 4,
  },
  sectionContainer: {
    marginTop: 12,
  },
  sectionTitle: {
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
    fontSize: 13,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  footerText: {
    fontSize: 11,
  },
  refreshTouch: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  refreshText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
