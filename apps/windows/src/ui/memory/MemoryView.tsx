import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Brain,
  Search,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useAgentStore } from '../context.ts';
import { ApiClient, type MemoryItem, type MemorySearchResult } from '../../api/client.ts';
import { Dialog } from '../components/Dialog.tsx';
import { Button } from '../components/Button.tsx';
import { useToast } from '../components/Toast.tsx';
import './MemoryView.css';

export const MemoryView: React.FC = () => {
  const { serverUrl, authToken } = useAgentStore();
  const { success, error, info } = useToast();

  const api = useMemo(
    () => new ApiClient({ baseUrl: () => serverUrl, token: () => authToken }),
    [serverUrl, authToken],
  );

  const [activeTab, setActiveTab] = useState<'active' | 'proposals'>('active');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [proposals, setProposals] = useState<MemoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemorySearchResult | null>(null);
  const [selectedScope, setSelectedScope] = useState<'all' | 'user' | 'project'>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [activeOnlyToggle, setActiveOnlyToggle] = useState(true);
  const [loading, setLoading] = useState(false);

  // Edit dialog state
  const [editingMemory, setEditingMemory] = useState<MemoryItem | null>(null);
  const [editContent, setEditContent] = useState('');

  // Delete dialog state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // New memory dialog state
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<string>('preference');
  const [newScope, setNewScope] = useState<'user' | 'project'>('user');

  // Load memories and proposals
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [memRes, propRes] = await Promise.all([
        api.listMemories(),
        api.listMemoryProposals(),
      ]);
      setMemories(memRes.data || []);
      setProposals(propRes.data || []);
    } catch (err) {
      error(`Gagal memuat memori: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [api, error]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Search handler with honest labeling
  const handleSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!query.trim()) {
        setSearchResults(null);
        return;
      }
      try {
        const res = await api.searchMemories(query);
        setSearchResults(res);
      } catch (err) {
        error(`Gagal melakukan pencarian: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [api, error],
  );

  // Approve proposal handler
  const handleApproveProposal = async (id: string) => {
    try {
      await api.approveMemoryProposal(id);
      success('Usulan memori disetujui dan kini aktif.');
      await loadData();
    } catch (err) {
      error(`Gagal menyetujui usulan: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Reject proposal handler
  const handleRejectProposal = async (id: string) => {
    try {
      await api.rejectMemoryProposal(id);
      info('Usulan memori ditolak.');
      await loadData();
    } catch (err) {
      error(`Gagal menolak usulan: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Save edited memory
  const handleSaveEdit = async () => {
    if (!editingMemory) return;
    try {
      await api.updateMemory(editingMemory.id, editContent);
      success('Koreksi memori berhasil disimpan.');
      setEditingMemory(null);
      await loadData();
    } catch (err) {
      error(`Gagal menyimpan koreksi: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Confirm delete memory
  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    try {
      await api.deleteMemory(deletingId);
      success('Memori berhasil dihapus.');
      setDeletingId(null);
      await loadData();
    } catch (err) {
      error(`Gagal menghapus memori: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Create manual memory
  const handleCreateMemory = async () => {
    if (!newContent.trim()) return;
    try {
      await api.createMemory({
        content: newContent.trim(),
        type: newType,
        scope: newScope,
      });
      success('Memori baru berhasil disimpan.');
      setIsNewDialogOpen(false);
      setNewContent('');
      await loadData();
    } catch (err) {
      error(`Kebijakan memori menolak: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Filtered active memories
  const displayedMemories = useMemo(() => {
    if (searchResults && searchQuery.trim()) {
      return searchResults.data.map((r) => r.memory);
    }
    return memories.filter((m) => {
      if (selectedScope === 'user' && m.scope !== 'user') return false;
      if (selectedScope === 'project' && m.scope === 'user') return false;
      if (selectedType !== 'all' && m.type !== selectedType) return false;
      return true;
    });
  }, [memories, searchResults, searchQuery, selectedScope, selectedType]);

  return (
    <div className="memory-view" role="main" aria-label="Manajemen Memori">
      {/* Header */}
      <div className="memory-header">
        <div className="memory-header-titles">
          <h1>Pusat Memori AI</h1>
          <p>
            Kelola preferensi, keputusan, pengetahuan, dan usulan memori dengan kontrol privasi penuh.
          </p>
        </div>

        <div className="memory-tabs">
          <button
            className={`memory-tab-btn ${activeTab === 'active' ? 'active' : ''}`}
            onClick={() => setActiveTab('active')}
          >
            <Brain size={16} />
            <span>Memori Aktif</span>
            <span className="memory-badge">{memories.length}</span>
          </button>

          <button
            className={`memory-tab-btn ${activeTab === 'proposals' ? 'active' : ''}`}
            onClick={() => setActiveTab('proposals')}
          >
            <ShieldCheck size={16} />
            <span>Antrean Usulan</span>
            {proposals.length > 0 && <span className="memory-badge">{proposals.length}</span>}
          </button>
        </div>
      </div>

      {activeTab === 'active' ? (
        <>
          {/* Controls Bar */}
          <div className="memory-controls-bar">
            <div className="memory-search-wrapper">
              <Search className="memory-search-icon" size={16} />
              <input
                type="text"
                className="memory-search-input"
                placeholder="Cari memori (pencarian teks PostgreSQL)..."
                value={searchQuery}
                onChange={(e) => void handleSearch(e.target.value)}
              />
            </div>

            <div className="memory-filter-group">
              <select
                className="memory-select"
                value={selectedScope}
                onChange={(e) => setSelectedScope(e.target.value as 'all' | 'user' | 'project')}
                aria-label="Filter Cakupan"
              >
                <option value="all">Semua Cakupan</option>
                <option value="user">Global (Pengguna)</option>
                <option value="project">Proyek</option>
              </select>

              <select
                className="memory-select"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                aria-label="Filter Tipe"
              >
                <option value="all">Semua Tipe</option>
                <option value="preference">Preferensi</option>
                <option value="decision">Keputusan</option>
                <option value="knowledge">Pengetahuan</option>
                <option value="task">Tugas</option>
              </select>

              <label className="memory-toggle-active">
                <input
                  type="checkbox"
                  checked={activeOnlyToggle}
                  onChange={(e) => setActiveOnlyToggle(e.target.checked)}
                />
                <span>Memori Aktif Saja</span>
              </label>

              <Button
                variant="primary"
                size="md"
                onClick={() => setIsNewDialogOpen(true)}
              >
                <Plus size={16} />
                <span>Tambah Memori</span>
              </Button>

              <Button
                variant="ghost"
                size="md"
                onClick={() => void loadData()}
                disabled={loading}
              >
                <RefreshCw size={16} className={loading ? 'spin' : ''} />
              </Button>
            </div>
          </div>

          {/* Honest Search Mode Notice */}
          {searchQuery.trim() && searchResults && (
            <div className="memory-notice-card">
              <AlertCircle size={18} />
              <span>
                {searchResults.notice ??
                  'Pencarian teks PostgreSQL (Non-Semantik): Provider embedding 9Router belum terkonfigurasi.'}
              </span>
            </div>
          )}

          {/* Memories List */}
          <div className="memory-list">
            {displayedMemories.length === 0 ? (
              <div className="memory-empty-state">
                <Brain size={36} />
                <p>Belum ada memori yang sesuai dengan kriteria.</p>
                <small>Gunakan tombol "Tambah Memori" atau setujui usulan dari aktivitas AI.</small>
              </div>
            ) : (
              displayedMemories.map((item) => (
                <div key={item.id} className="memory-card">
                  <div className="memory-card-header">
                    <div className="memory-tags">
                      <span className={`tag tag-${item.type}`}>{item.type}</span>
                      <span className="tag tag-scope">
                        {item.scope === 'user' ? 'Global' : `Proyek: ${item.projectId ?? 'Lokal'}`}
                      </span>
                      {searchResults && searchQuery.trim() && (
                        <span className="tag tag-search-mode">Mode: Teks PostgreSQL</span>
                      )}
                    </div>
                    <div className="memory-card-actions">
                      <button
                        className="memory-action-btn"
                        onClick={() => {
                          setEditingMemory(item);
                          setEditContent(item.content);
                        }}
                        title="Koreksi memori"
                      >
                        <Edit2 size={14} />
                        <span>Koreksi</span>
                      </button>
                      <button
                        className="memory-action-btn btn-reject"
                        onClick={() => setDeletingId(item.id)}
                        title="Hapus memori"
                      >
                        <Trash2 size={14} />
                        <span>Hapus</span>
                      </button>
                    </div>
                  </div>

                  <div className="memory-card-content">{item.content}</div>

                  <div className="memory-card-footer">
                    <span>Sumber: {item.provenance}</span>
                    <span>Retensi: {item.retention ?? 'Permanen'}</span>
                    <span>Dibuat: {new Date(item.createdAt).toLocaleDateString('id-ID')}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        /* Proposals Queue Tab */
        <div className="memory-list">
          <div className="memory-notice-card notice-info">
            <ShieldCheck size={20} />
            <span>
              <strong>Prinsip Privasi Memori:</strong> Tidak ada penyimpanan diam-diam. Semua temuan
              dari task atau obrolan disimpan sebagai usulan yang memerlukan persetujuan Anda sebelum
              dapat diakses oleh AI.
            </span>
          </div>

          {proposals.length === 0 ? (
            <div className="memory-empty-state">
              <CheckCircle2 size={36} color="#10b981" />
              <p>Tidak ada usulan memori yang menunggu persetujuan.</p>
              <small>Ketika AI menemukan preferensi atau keputusan penting, usulan akan muncul di sini.</small>
            </div>
          ) : (
            proposals.map((item) => (
              <div key={item.id} className="memory-card">
                <div className="memory-card-header">
                  <div className="memory-tags">
                    <span className="tag tag-decision">Usulan {item.type}</span>
                    <span className="tag tag-scope">
                      {item.scope === 'user' ? 'Global' : `Proyek: ${item.projectId ?? 'Lokal'}`}
                    </span>
                  </div>

                  <div className="memory-card-actions">
                    <button
                      className="memory-action-btn btn-approve"
                      onClick={() => void handleApproveProposal(item.id)}
                    >
                      <CheckCircle2 size={15} />
                      <span>Setujui</span>
                    </button>
                    <button
                      className="memory-action-btn btn-reject"
                      onClick={() => void handleRejectProposal(item.id)}
                    >
                      <XCircle size={15} />
                      <span>Tolak</span>
                    </button>
                  </div>
                </div>

                <div className="memory-card-content">{item.content}</div>

                <div className="memory-card-footer">
                  <span>Asal: {item.provenance}</span>
                  <span>Diambil: {new Date(item.createdAt).toLocaleString('id-ID')}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Edit Correction Dialog */}
      {editingMemory && (
        <Dialog
          isOpen={Boolean(editingMemory)}
          onClose={() => setEditingMemory(null)}
          title="Koreksi Memori Pengguna"
        >
          <div className="memory-dialog-content">
            <p className="memory-dialog-desc">
              Ubah atau sempurnakan catatan memori agar AI memahaminya secara akurat.
            </p>
            <textarea
              className="memory-search-input memory-dialog-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
            />
            <div className="memory-dialog-actions">
              <Button variant="ghost" onClick={() => setEditingMemory(null)}>
                Batal
              </Button>
              <Button variant="primary" onClick={() => void handleSaveEdit()}>
                Simpan Koreksi
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      {deletingId && (
        <Dialog
          isOpen={Boolean(deletingId)}
          onClose={() => setDeletingId(null)}
          title="Hapus Memori"
        >
          <div className="memory-dialog-content">
            <p>Apakah Anda yakin ingin menghapus memori ini? Tindakan ini tidak dapat dibatalkan.</p>
            <div className="memory-dialog-actions">
              <Button variant="ghost" onClick={() => setDeletingId(null)}>
                Batal
              </Button>
              <Button variant="danger" onClick={() => void handleConfirmDelete()}>
                Hapus Permanen
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Manual Memory Creation Dialog */}
      {isNewDialogOpen && (
        <Dialog
          isOpen={isNewDialogOpen}
          onClose={() => setIsNewDialogOpen(false)}
          title="Tambah Memori Baru"
        >
          <div className="memory-dialog-content">
            <div className="memory-dialog-grid-row">
              <div className="memory-dialog-grid-col">
                <label className="memory-dialog-label">
                  Tipe Memori
                </label>
                <select
                  className="memory-select memory-dialog-select"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                >
                  <option value="preference">Preferensi</option>
                  <option value="decision">Keputusan</option>
                  <option value="knowledge">Pengetahuan</option>
                  <option value="task">Tugas</option>
                </select>
              </div>

              <div className="memory-dialog-grid-col">
                <label className="memory-dialog-label">
                  Cakupan
                </label>
                <select
                  className="memory-select memory-dialog-select"
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value as 'user' | 'project')}
                >
                  <option value="user">Global (Pengguna)</option>
                  <option value="project">Proyek</option>
                </select>
              </div>
            </div>

            <div>
              <label className="memory-dialog-label">
                Isi Memori (Data sensitif/kredensial dilarang)
              </label>
              <textarea
                className="memory-search-input memory-dialog-textarea"
                placeholder="Contoh: Selalu sertakan kesimpulan eksekutif di awal setiap laporan arsitektur."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
              />
            </div>

            <div className="memory-dialog-actions">
              <Button variant="ghost" onClick={() => setIsNewDialogOpen(false)}>
                Batal
              </Button>
              <Button variant="primary" onClick={() => void handleCreateMemory()}>
                Simpan
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
