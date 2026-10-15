import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowLeft,
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
import { theme } from '../components/Theme.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface MemoryScreenProps {
  onBack?: () => void;
}

export const MemoryScreen: React.FC<MemoryScreenProps> = ({ onBack }) => {
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
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={styles.backButton}>
              <ArrowLeft size={22} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          )}
          <View>
            <Text style={styles.title}>Pusat Memori</Text>
            <Text style={styles.subtitle}>Kontrol privasi & data jangka panjang AI</Text>
          </View>
        </View>

        <TouchableOpacity onPress={() => void loadData()} style={styles.iconButton}>
          <RefreshCw size={20} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'active' && styles.tabButtonActive]}
          onPress={() => setActiveTab('active')}
        >
          <Brain size={16} color={activeTab === 'active' ? theme.colors.primary : theme.colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'active' && styles.tabTextActive]}>
            Memori Aktif ({memories.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'proposals' && styles.tabButtonActive]}
          onPress={() => setActiveTab('proposals')}
        >
          <ShieldCheck size={16} color={activeTab === 'proposals' ? theme.colors.primary : theme.colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'proposals' && styles.tabTextActive]}>
            Usulan AI ({proposals.length})
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'active' ? (
        <>
          {/* Search Bar */}
          <View style={styles.searchBox}>
            <Search size={18} color={theme.colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Cari memori (pencarian teks)..."
              placeholderTextColor={theme.colors.textSecondary}
              value={searchQuery}
              onChangeText={(text) => void handleSearch(text)}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => void handleSearch('')}>
                <X size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Honest Search Notice */}
          {searchQuery.trim().length > 0 && (
            <View style={styles.noticeBanner}>
              <Text style={styles.noticeText}>
                Mode: Pencarian teks PostgreSQL (Non-Semantik). Provider embedding 9Router belum dikonfigurasi.
              </Text>
            </View>
          )}

          {/* Scope Filter Chips */}
          <View style={styles.filterRow}>
            {(['all', 'user', 'project'] as const).map((sc) => (
              <TouchableOpacity
                key={sc}
                style={[styles.chip, scopeFilter === sc && styles.chipActive]}
                onPress={() => setScopeFilter(sc)}
              >
                <Text style={[styles.chipText, scopeFilter === sc && styles.chipTextActive]}>
                  {sc === 'all' ? 'Semua' : sc === 'user' ? 'Global' : 'Proyek'}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.addMemoryButton}
              onPress={() => setIsAddModalOpen(true)}
            >
              <Plus size={16} color="#fff" />
              <Text style={styles.addMemoryText}>Tambah</Text>
            </TouchableOpacity>
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
                  <Text style={styles.emptyTitle}>Belum Ada Memori</Text>
                  <Text style={styles.emptyText}>
                    Memori yang Anda simpan atau setujui dari usulan AI akan tercantum di sini.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.tagGroup}>
                      <View style={[styles.badge, { backgroundColor: item.type === 'preference' ? '#2563eb' : '#7c3aed' }]}>
                        <Text style={styles.badgeText}>{item.type}</Text>
                      </View>
                      <View style={styles.scopeBadge}>
                        <Text style={styles.scopeBadgeText}>
                          {item.scope === 'user' ? 'Global' : 'Proyek'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.cardActions}>
                      <TouchableOpacity
                        onPress={() => {
                          setEditingItem(item);
                          setEditContent(item.content);
                        }}
                        style={styles.cardActionBtn}
                      >
                        <Edit2 size={16} color={theme.colors.textPrimary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(item.id)}
                        style={styles.cardActionBtn}
                      >
                        <Trash2 size={16} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <Text style={styles.cardContent}>{item.content}</Text>

                  <View style={styles.cardFooter}>
                    <Text style={styles.footerText}>Sumber: {item.provenance}</Text>
                    <Text style={styles.footerText}>
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
          <View style={[styles.noticeBanner, { borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)' }]}>
            <Text style={[styles.noticeText, { color: '#3b82f6' }]}>
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
                  <CheckCircle2 size={40} color="#10b981" />
                  <Text style={styles.emptyTitle}>Antrean Usulan Kosong</Text>
                  <Text style={styles.emptyText}>
                    Saat AI mendeteksi preferensi atau keputusan penting, usulan akan muncul di sini.
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={[styles.card, { borderColor: '#3b82f6' }]}>
                  <View style={styles.cardHeader}>
                    <View style={styles.tagGroup}>
                      <View style={[styles.badge, { backgroundColor: '#3b82f6' }]}>
                        <Text style={styles.badgeText}>Usulan {item.type}</Text>
                      </View>
                      <View style={styles.scopeBadge}>
                        <Text style={styles.scopeBadgeText}>
                          {item.scope === 'user' ? 'Global' : 'Proyek'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Text style={styles.cardContent}>{item.content}</Text>

                  <View style={styles.cardFooter}>
                    <Text style={styles.footerText}>Asal: {item.provenance}</Text>
                  </View>

                  <View style={styles.proposalActions}>
                    <TouchableOpacity
                      style={[styles.proposalBtn, styles.approveBtn]}
                      onPress={() => void handleApprove(item.id)}
                    >
                      <CheckCircle2 size={16} color="#fff" />
                      <Text style={styles.proposalBtnText}>Setujui</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.proposalBtn, styles.rejectBtn]}
                      onPress={() => void handleReject(item.id)}
                    >
                      <XCircle size={16} color="#ef4444" />
                      <Text style={[styles.proposalBtnText, { color: '#ef4444' }]}>Tolak</Text>
                    </TouchableOpacity>
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
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Koreksi Memori</Text>
            <Text style={styles.modalSubtitle}>Perbaiki konten memori pengguna:</Text>
            <TextInput
              style={styles.modalInput}
              multiline
              numberOfLines={4}
              value={editContent}
              onChangeText={setEditContent}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setEditingItem(null)}
              >
                <Text style={styles.modalBtnText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn]}
                onPress={() => void handleSaveEdit()}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Simpan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Memory Modal */}
      <Modal visible={isAddModalOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tambah Memori Baru</Text>
            <Text style={styles.modalSubtitle}>
              Tulis fakta atau preferensi (dilarang memasukkan kredensial/rahasia):
            </Text>

            <View style={styles.typeSelectorRow}>
              {(['preference', 'decision', 'knowledge'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, newType === t && styles.chipActive]}
                  onPress={() => setNewType(t)}
                >
                  <Text style={[styles.chipText, newType === t && styles.chipTextActive]}>
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.typeSelectorRow}>
              {(['user', 'project'] as const).map((sc) => (
                <TouchableOpacity
                  key={sc}
                  style={[styles.chip, newScope === sc && styles.chipActive]}
                  onPress={() => setNewScope(sc)}
                >
                  <Text style={[styles.chipText, newScope === sc && styles.chipTextActive]}>
                    {sc === 'user' ? 'Global' : 'Proyek'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Contoh: Selalu gunakan format ringkas dan Bahasa Indonesia."
              placeholderTextColor={theme.colors.textSecondary}
              multiline
              numberOfLines={4}
              value={newContent}
              onChangeText={setNewContent}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setIsAddModalOpen(false)}
              >
                <Text style={styles.modalBtnText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn]}
                onPress={() => void handleCreate()}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Simpan</Text>
              </TouchableOpacity>
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
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    padding: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  iconButton: {
    padding: 8,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
    borderRadius: 6,
  },
  tabButtonActive: {
    backgroundColor: theme.colors.background,
  },
  tabText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  tabTextActive: {
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 14,
  },
  noticeBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  noticeText: {
    fontSize: 12,
    color: '#f59e0b',
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
  },
  chipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  chipText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  addMemoryButton: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  addMemoryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
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
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
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
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
  },
  scopeBadgeText: {
    color: theme.colors.textSecondary,
    fontSize: 11,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  cardActionBtn: {
    padding: 4,
  },
  cardContent: {
    fontSize: 14,
    color: theme.colors.textPrimary,
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: theme.colors.surfaceBorder,
    paddingTop: 8,
    marginTop: 4,
  },
  footerText: {
    fontSize: 11,
    color: theme.colors.textSecondary,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 6,
  },
  approveBtn: {
    backgroundColor: '#10b981',
  },
  rejectBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  proposalBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  emptyText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
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
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 18,
    gap: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  modalInput: {
    backgroundColor: theme.colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    padding: 10,
    color: theme.colors.textPrimary,
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
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  cancelBtn: {
    backgroundColor: theme.colors.background,
  },
  saveBtn: {
    backgroundColor: theme.colors.primary,
  },
  modalBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  typeSelectorRow: {
    flexDirection: 'row',
    gap: 8,
  },
});
