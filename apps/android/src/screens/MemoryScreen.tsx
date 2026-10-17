import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Brain,
  CheckCircle2,
  Edit2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react-native';
import { defaultApiClient } from '../api/client.ts';
import type { MemoryItem, MemorySearchResult } from '../api/types.ts';
import { ScreenHeader } from '../components/ScreenHeader.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface MemoryScreenProps {
  onBack?: () => void;
}

export const MemoryScreen: React.FC<MemoryScreenProps> = ({ onBack }) => {
  const theme = useAppTheme();
  const { showToast } = useUiStore();

  const [activeTab, setActiveTab] = useState<'active' | 'proposals'>('active');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [proposals, setProposals] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemorySearchResult | null>(null);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'user' | 'project'>('all');

  // Edit modal state
  const [editingItem, setEditingItem] = useState<MemoryItem | null>(null);
  const [editContent, setEditContent] = useState('');

  // New memory modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<string>('preference');
  const [newScope, setNewScope] = useState<'user' | 'project'>('user');

  const loadData = async () => {
    setLoading(true);
    try {
      const [memRes, propRes] = await Promise.all([
        defaultApiClient.listMemories(),
        defaultApiClient.listMemoryProposals(),
      ]);
      setMemories(memRes.data || []);
      setProposals(propRes.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal memuat data memori');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (!text.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await defaultApiClient.searchMemories(text);
      setSearchResults(res);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal mencari memori');
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await defaultApiClient.approveMemoryProposal(id);
      showToast('Usulan memori disetujui');
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyetujui');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await defaultApiClient.rejectMemoryProposal(id);
      showToast('Usulan memori ditolak');
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menolak');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    try {
      await defaultApiClient.updateMemory(editingItem.id, editContent);
      showToast('Koreksi memori berhasil disimpan');
      setEditingItem(null);
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan');
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('Hapus Memori', 'Apakah Anda yakin ingin menghapus catatan memori ini?', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          try {
            await defaultApiClient.deleteMemory(id);
            showToast('Memori dihapus');
            await loadData();
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Gagal menghapus');
          }
        },
      },
    ]);
  };

  const handleCreate = async () => {
    if (!newContent.trim()) return;
    try {
      await defaultApiClient.createMemory({
        content: newContent.trim(),
        type: newType,
        scope: newScope,
      });
      showToast('Memori baru berhasil disimpan');
      setIsAddModalOpen(false);
      setNewContent('');
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Kebijakan memori menolak input');
    }
  };

  const displayedMemories = useMemo(() => {
    if (searchResults && searchQuery.trim()) {
      return searchResults.data.map((r) => r.memory);
    }
    return memories.filter((m) => {
      if (scopeFilter === 'user' && m.scope !== 'user') return false;
      if (scopeFilter === 'project' && m.scope === 'user') return false;
      return true;
    });
  }, [memories, searchResults, searchQuery, scopeFilter]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Standard Screen Header */}
      <ScreenHeader
        title="Pusat Memori"
        subtitle="Kontrol privasi & data jangka panjang AI"
        onBack={onBack}
        rightElement={
          <Pressable
            android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
            onPress={() => void loadData()}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Muat ulang memori"
          >
            <RefreshCw size={20} color={theme.colors.textSecondary} />
          </Pressable>
        }
      />

      {/* Tabs */}
      <View
        style={[
          styles.tabContainer,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <Pressable
          android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
          style={[
            styles.tabButton,
            activeTab === 'active' && { backgroundColor: theme.colors.surfaceElevated },
          ]}
          onPress={() => setActiveTab('active')}
          accessibilityRole="tab"
          accessibilityLabel={`Memori Aktif (${memories.length})`}
        >
          <Brain
            size={16}
            color={activeTab === 'active' ? theme.colors.primary : theme.colors.textSecondary}
          />
          <Text
            style={[
              styles.tabText,
              {
                color: activeTab === 'active' ? theme.colors.primary : theme.colors.textSecondary,
                fontWeight: activeTab === 'active' ? '700' : '600',
              },
            ]}
            allowFontScaling
          >
            Memori Aktif ({memories.length})
          </Text>
        </Pressable>

        <Pressable
          android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
          style={[
            styles.tabButton,
            activeTab === 'proposals' && { backgroundColor: theme.colors.surfaceElevated },
          ]}
          onPress={() => setActiveTab('proposals')}
          accessibilityRole="tab"
          accessibilityLabel={`Usulan AI (${proposals.length})`}
        >
          <ShieldCheck
            size={16}
            color={activeTab === 'proposals' ? theme.colors.primary : theme.colors.textSecondary}
          />
          <Text
            style={[
              styles.tabText,
              {
                color: activeTab === 'proposals' ? theme.colors.primary : theme.colors.textSecondary,
                fontWeight: activeTab === 'proposals' ? '700' : '600',
              },
            ]}
            allowFontScaling
          >
            Usulan AI ({proposals.length})
          </Text>
        </Pressable>
      </View>

      {activeTab === 'active' ? (
        <>
          {/* Search Bar */}
          <View
            style={[
              styles.searchBox,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            <Search size={18} color={theme.colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: theme.colors.textPrimary }]}
              placeholder="Cari memori (pencarian teks)..."
              placeholderTextColor={theme.colors.textMuted}
              value={searchQuery}
              onChangeText={(text) => void handleSearch(text)}
              accessibilityLabel="Cari memori"
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => void handleSearch('')}
                accessibilityRole="button"
                accessibilityLabel="Bersihkan pencarian"
              >
                <X size={18} color={theme.colors.textSecondary} />
              </Pressable>
            )}
          </View>

          {/* Honest Search Notice */}
          {searchQuery.trim().length > 0 && (
            <View
              style={[
                styles.noticeBanner,
                {
                  backgroundColor: theme.colors.riskMediumBg,
                  borderColor: theme.colors.riskMedium,
                },
              ]}
            >
              <Text
                style={[styles.noticeText, { color: theme.colors.riskMedium }]}
                allowFontScaling
              >
                Mode: Pencarian teks PostgreSQL (Non-Semantik). Provider embedding 9Router belum dikonfigurasi.
              </Text>
            </View>
          )}

          {/* Scope Filter Chips */}
          <View style={styles.filterRow}>
            {(['all', 'user', 'project'] as const).map((sc) => {
              const isSelected = scopeFilter === sc;
              return (
                <Pressable
                  key={sc}
                  android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: isSelected
                        ? theme.colors.primary
                        : theme.colors.surfaceElevated,
                      borderColor: isSelected ? theme.colors.primary : theme.colors.surfaceBorder,
                    },
                  ]}
                  onPress={() => setScopeFilter(sc)}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter ${sc === 'all' ? 'Semua' : sc === 'user' ? 'Global' : 'Proyek'}`}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: isSelected ? '#fff' : theme.colors.textSecondary,
                        fontWeight: isSelected ? '700' : '600',
                      },
                    ]}
                    allowFontScaling
                  >
                    {sc === 'all' ? 'Semua' : sc === 'user' ? 'Global' : 'Proyek'}
                  </Text>
                </Pressable>
              );
            })}

            <Pressable
              android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
              style={[styles.addMemoryButton, { backgroundColor: theme.colors.primary }]}
              onPress={() => setIsAddModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Tambah catatan memori baru"
            >
              <Plus size={16} color="#fff" />
              <Text style={styles.addMemoryText} allowFontScaling>
                Tambah
              </Text>
            </Pressable>
          </View>

          {/* Memories List */}
          {loading ? (
            <ActivityIndicator style={styles.loader} color={theme.colors.primary} size="large" />
          ) : (
            <FlatList
              data={displayedMemories}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Brain size={40} color={theme.colors.textSecondary} />
                  <Text
                    style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}
                    allowFontScaling
                  >
                    Belum Ada Memori
                  </Text>
                  <Text
                    style={[styles.emptyText, { color: theme.colors.textSecondary }]}
                    allowFontScaling
                  >
                    Memori yang Anda simpan atau setujui dari usulan AI akan tercantum di sini.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.surfaceBorder,
                    },
                  ]}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.tagGroup}>
                      <View
                        style={[
                          styles.badge,
                          {
                            backgroundColor:
                              item.type === 'preference'
                                ? theme.colors.primary
                                : theme.colors.surfaceElevated,
                          },
                        ]}
                      >
                        <Text style={styles.badgeText} allowFontScaling>
                          {item.type}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.scopeBadge,
                          {
                            backgroundColor: theme.colors.surfaceElevated,
                            borderColor: theme.colors.surfaceBorder,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.scopeBadgeText, { color: theme.colors.textSecondary }]}
                          allowFontScaling
                        >
                          {item.scope === 'user' ? 'Global' : 'Proyek'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.cardActions}>
                      <Pressable
                        android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
                        onPress={() => {
                          setEditingItem(item);
                          setEditContent(item.content);
                        }}
                        style={styles.cardActionBtn}
                        accessibilityRole="button"
                        accessibilityLabel="Koreksi memori"
                      >
                        <Edit2 size={16} color={theme.colors.textPrimary} />
                      </Pressable>
                      <Pressable
                        android_ripple={{ color: 'rgba(239, 68, 68, 0.2)' }}
                        onPress={() => handleDelete(item.id)}
                        style={styles.cardActionBtn}
                        accessibilityRole="button"
                        accessibilityLabel="Hapus memori"
                      >
                        <Trash2 size={16} color={theme.colors.danger} />
                      </Pressable>
                    </View>
                  </View>

                  <Text
                    style={[styles.cardContent, { color: theme.colors.textPrimary }]}
                    allowFontScaling
                  >
                    {item.content}
                  </Text>

                  <View
                    style={[
                      styles.cardFooter,
                      { borderTopColor: theme.colors.surfaceBorder },
                    ]}
                  >
                    <Text
                      style={[styles.footerText, { color: theme.colors.textMuted }]}
                      allowFontScaling
                    >
                      Sumber: {item.provenance}
                    </Text>
                    <Text
                      style={[styles.footerText, { color: theme.colors.textMuted }]}
                      allowFontScaling
                    >
                      {new Date(item.createdAt).toLocaleDateString('id-ID')}
                    </Text>
                  </View>
                </View>
              )}
            />
          )}
        </>
      ) : (
        /* Proposals Queue */
        <View style={styles.proposalsContainer}>
          <View
            style={[
              styles.noticeBanner,
              {
                borderColor: theme.colors.primary,
                backgroundColor: theme.colors.surfaceElevated,
                marginHorizontal: 16,
              },
            ]}
          >
            <Text
              style={[styles.noticeText, { color: theme.colors.primary }]}
              allowFontScaling
            >
              Tidak ada penyimpanan diam-diam. AI mengajukan catatan penting sebagai usulan yang harus Anda setujui terlebih dahulu.
            </Text>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.loader} color={theme.colors.primary} size="large" />
          ) : (
            <FlatList
              data={proposals}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <CheckCircle2 size={40} color={theme.colors.success} />
                  <Text
                    style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}
                    allowFontScaling
                  >
                    Antrean Usulan Kosong
                  </Text>
                  <Text
                    style={[styles.emptyText, { color: theme.colors.textSecondary }]}
                    allowFontScaling
                  >
                    Saat AI mendeteksi preferensi atau keputusan penting, usulan akan muncul di sini.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.primary,
                    },
                  ]}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.tagGroup}>
                      <View
                        style={[styles.badge, { backgroundColor: theme.colors.primary }]}
                      >
                        <Text style={styles.badgeText} allowFontScaling>
                          Usulan {item.type}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.scopeBadge,
                          {
                            backgroundColor: theme.colors.surfaceElevated,
                            borderColor: theme.colors.surfaceBorder,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.scopeBadgeText, { color: theme.colors.textSecondary }]}
                          allowFontScaling
                        >
                          {item.scope === 'user' ? 'Global' : 'Proyek'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Text
                    style={[styles.cardContent, { color: theme.colors.textPrimary }]}
                    allowFontScaling
                  >
                    {item.content}
                  </Text>

                  <View
                    style={[
                      styles.cardFooter,
                      { borderTopColor: theme.colors.surfaceBorder },
                    ]}
                  >
                    <Text
                      style={[styles.footerText, { color: theme.colors.textMuted }]}
                      allowFontScaling
                    >
                      Asal: {item.provenance}
                    </Text>
                  </View>

                  <View style={styles.proposalActions}>
                    <Pressable
                      android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
                      style={[styles.proposalBtn, { backgroundColor: theme.colors.success }]}
                      onPress={() => void handleApprove(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel="Setujui usulan memori"
                    >
                      <CheckCircle2 size={16} color="#fff" />
                      <Text style={[styles.proposalBtnText, { color: '#fff' }]} allowFontScaling>
                        Setujui
                      </Text>
                    </Pressable>

                    <Pressable
                      android_ripple={{ color: 'rgba(239, 68, 68, 0.2)' }}
                      style={[
                        styles.proposalBtn,
                        {
                          backgroundColor: theme.colors.dangerBg,
                          borderColor: theme.colors.danger,
                          borderWidth: 1,
                        },
                      ]}
                      onPress={() => void handleReject(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel="Tolak usulan memori"
                    >
                      <XCircle size={16} color={theme.colors.danger} />
                      <Text
                        style={[styles.proposalBtnText, { color: theme.colors.danger }]}
                        allowFontScaling
                      >
                        Tolak
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* Edit Correction Modal */}
      <Modal visible={Boolean(editingItem)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
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
              Koreksi Memori
            </Text>
            <Text
              style={[styles.modalSubtitle, { color: theme.colors.textSecondary }]}
              allowFontScaling
            >
              Perbaiki konten memori pengguna:
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                  color: theme.colors.textPrimary,
                },
              ]}
              multiline
              numberOfLines={4}
              value={editContent}
              onChangeText={setEditContent}
              accessibilityLabel="Koreksi konten memori"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.surfaceBorder,
                    borderWidth: 1,
                  },
                ]}
                onPress={() => setEditingItem(null)}
                accessibilityRole="button"
                accessibilityLabel="Batal koreksi"
              >
                <Text
                  style={[styles.modalBtnText, { color: theme.colors.textPrimary }]}
                  allowFontScaling
                >
                  Batal
                </Text>
              </TouchableOpacity>
              <Pressable
                android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
                style={[styles.modalBtn, { backgroundColor: theme.colors.primary }]}
                onPress={() => void handleSaveEdit()}
                accessibilityRole="button"
                accessibilityLabel="Simpan koreksi"
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]} allowFontScaling>
                  Simpan
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Memory Modal */}
      <Modal visible={isAddModalOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
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
              Tambah Memori Baru
            </Text>
            <Text
              style={[styles.modalSubtitle, { color: theme.colors.textSecondary }]}
              allowFontScaling
            >
              Tulis fakta atau preferensi (dilarang memasukkan kredensial/rahasia):
            </Text>

            <View style={styles.typeSelectorRow}>
              {(['preference', 'decision', 'knowledge'] as const).map((t) => (
                <Pressable
                  key={t}
                  android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        newType === t ? theme.colors.primary : theme.colors.surfaceElevated,
                      borderColor:
                        newType === t ? theme.colors.primary : theme.colors.surfaceBorder,
                    },
                  ]}
                  onPress={() => setNewType(t)}
                  accessibilityRole="button"
                  accessibilityLabel={`Tipe ${t}`}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: newType === t ? '#fff' : theme.colors.textSecondary,
                        fontWeight: newType === t ? '700' : '600',
                      },
                    ]}
                    allowFontScaling
                  >
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.typeSelectorRow}>
              {(['user', 'project'] as const).map((sc) => (
                <Pressable
                  key={sc}
                  android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        newScope === sc ? theme.colors.primary : theme.colors.surfaceElevated,
                      borderColor:
                        newScope === sc ? theme.colors.primary : theme.colors.surfaceBorder,
                    },
                  ]}
                  onPress={() => setNewScope(sc)}
                  accessibilityRole="button"
                  accessibilityLabel={`Lingkup ${sc === 'user' ? 'Global' : 'Proyek'}`}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: newScope === sc ? '#fff' : theme.colors.textSecondary,
                        fontWeight: newScope === sc ? '700' : '600',
                      },
                    ]}
                    allowFontScaling
                  >
                    {sc === 'user' ? 'Global' : 'Proyek'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={[
                styles.modalInput,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                  color: theme.colors.textPrimary,
                },
              ]}
              placeholder="Contoh: Selalu gunakan format ringkas dan Bahasa Indonesia."
              placeholderTextColor={theme.colors.textMuted}
              multiline
              numberOfLines={4}
              value={newContent}
              onChangeText={setNewContent}
              accessibilityLabel="Konten memori baru"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.surfaceBorder,
                    borderWidth: 1,
                  },
                ]}
                onPress={() => setIsAddModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Batal"
              >
                <Text
                  style={[styles.modalBtnText, { color: theme.colors.textPrimary }]}
                  allowFontScaling
                >
                  Batal
                </Text>
              </TouchableOpacity>
              <Pressable
                android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
                style={[styles.modalBtn, { backgroundColor: theme.colors.primary }]}
                onPress={() => void handleCreate()}
                accessibilityRole="button"
                accessibilityLabel="Simpan memori"
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]} allowFontScaling>
                  Simpan
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  iconButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
  },
  tabText: {
    fontSize: 13,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 48,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  noticeBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
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
    fontSize: 12,
  },
  addMemoryButton: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    justifyContent: 'center',
  },
  addMemoryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  loader: {
    marginTop: 32,
  },
  card: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tagGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  scopeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  scopeBadgeText: {
    fontSize: 11,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 6,
  },
  cardActionBtn: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContent: {
    fontSize: 14,
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 8,
    marginTop: 4,
  },
  footerText: {
    fontSize: 11,
  },
  proposalsContainer: {
    flex: 1,
  },
  proposalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  proposalBtn: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
  },
  proposalBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    gap: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 13,
  },
  modalInput: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    fontSize: 14,
    textAlignVertical: 'top',
    minHeight: 90,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  modalBtn: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  typeSelectorRow: {
    flexDirection: 'row',
    gap: 8,
  },
});
