import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from './context.ts';
import './Theme.css';

interface FileTreeEntry { path: string; name: string; kind: 'directory' | 'file'; size: number; }

const ProjectPanel: React.FC = () => {
  const { allowedRoots, capabilities } = useAgentStore();
  const [root, setRoot] = useState(allowedRoots[0] ?? '');
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [text, setText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!allowedRoots.includes(root)) setRoot(allowedRoots[0] ?? ''); }, [allowedRoots, root]);
  const refresh = async () => { if (!root) return; setLoading(true); setError(null); try { setEntries(await invoke<FileTreeEntry[]>('list_allowed_tree', { path: root, maxDepth: 6 })); } catch (err) { setError(String(err)); } finally { setLoading(false); } };
  const openFile = async (path: string) => { setSelectedPath(path); setError(null); try { const content = await invoke<string>('read_allowed_text', { path, maxBytes: 512_000 }); setText(content); setOriginalText(content); } catch (err) { setError(String(err)); setText(''); setOriginalText(''); } };
  const save = async () => { if (!selectedPath || text === originalText || !capabilities.filesystem) return; if (!window.confirm(`Write changes to ${selectedPath}?\n\nOld/new text differs.`)) return; setError(null); try { await invoke('write_allowed_file', { path: selectedPath, content: text }); setOriginalText(text); await refresh(); } catch (err) { setError(String(err)); } };
  const diffPreview = selectedPath && text !== originalText ? <details><summary>Diff preview</summary><pre style={{ maxHeight: 120, overflow: 'auto' }}>{`OLD\n${originalText}\nNEW\n${text}`}</pre></details> : null;
  return <section className="card" style={{ marginTop: 12 }}><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><h2 className="card-title" style={{ margin: 0 }}>Project</h2><select className="text-input" value={root} onChange={(event) => setRoot(event.target.value)}>{allowedRoots.map((path) => <option key={path} value={path}>{path}</option>)}</select><button className="btn btn-secondary btn-sm" onClick={() => void refresh()} disabled={!root || loading}>Refresh</button></div>{error && <div className="chat-error">{error}</div>}<div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 2fr', gap: 10, marginTop: 10 }}><div style={{ maxHeight: 260, overflow: 'auto' }}>{entries.map((entry) => <button key={entry.path} className="chat-conversation" style={{ display: 'block', width: '100%', textAlign: 'left' }} disabled={entry.kind === 'directory'} onClick={() => void openFile(entry.path)}>{entry.kind === 'directory' ? '📁 ' : '📄 '}{entry.name}</button>)}</div><div>{diffPreview}<textarea className="text-input" style={{ width: '100%', minHeight: 220, fontFamily: 'monospace' }} value={text} onChange={(event) => setText(event.target.value)} disabled={!selectedPath} placeholder="Select an allowlisted text file" />{selectedPath && <div style={{ display: 'flex', gap: 8, marginTop: 6 }}><code>{selectedPath}</code><button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!capabilities.filesystem || text === originalText}>Save after confirmation</button></div>}</div></div></section>;
};

const ChatPanel: React.FC = () => {
  const state = useAgentStore();
  const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
  return <div><div className="chat-layout"><aside className="card chat-sidebar"><button className="btn btn-primary" onClick={state.newConversation}>New conversation</button>{state.conversations.filter((item) => item.id).map((item) => <button key={item.id} className="chat-conversation" onClick={() => state.setActiveConversation(item.id)}>{item.title}</button>)}</aside><section className="card chat-panel"><div className="chat-toolbar"><select value={state.selectedMode} onChange={(event) => state.setSelectedMode(event.target.value as typeof state.selectedMode)}><option value="auto">Auto</option><option value="fast">Fast</option><option value="coding">Coding</option><option value="complex">Complex</option><option value="research">Research</option></select><input className="text-input" value={state.selectedModel} onChange={(event) => state.setSelectedModel(event.target.value)} placeholder="Model (auto)" /></div><div className="chat-messages">{conversation?.messages.map((message) => <div key={message.id} className={`chat-message ${message.role}`}><strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong><div>{message.content}</div></div>)}</div>{state.chatError && <div className="chat-error">{state.chatError}<button className="btn btn-sm" onClick={state.clearChatError}>Clear</button><button className="btn btn-sm" onClick={state.retryChat}>Retry</button></div>}<textarea className="text-input chat-input" value={state.chatDraft} onChange={(event) => state.setChatDraft(event.target.value)} placeholder="Message" />{state.chatStreaming ? <button className="btn btn-danger" onClick={state.cancelChat}>Cancel</button> : <button className="btn btn-primary" onClick={state.sendChat} disabled={!state.chatDraft.trim()}>Send</button>}</section></div><ProjectPanel /></div>;
};
const ModelSettings: React.FC = () => {
  const { serverUrl, authToken } = useAgentStore();
  const [status, setStatus] = useState('Loading model catalog...');
  const [models, setModels] = useState<Array<{ id: string; capabilities?: string[] }>>([]);
  const refresh = async () => {
    try {
      const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/v1/models`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
      const body = (await response.json()) as { source?: string; models?: Array<{ id: string; capabilities?: string[] }> };
      setModels(body.models ?? []);
      setStatus(`Source: ${body.source ?? 'unknown'} · ${body.models?.length ?? 0} models`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Model catalog unavailable'); }
  };
  useEffect(() => { void refresh(); }, [serverUrl, authToken]);
  return <div className="card" style={{ marginTop: 12 }}><h3 className="card-title">Model catalog</h3><p className="card-subtitle">{status}</p>{models.map((model) => <div key={model.id} className="log-entry"><span className="log-text">{model.id}</span><span className="log-time">{model.capabilities?.join(', ') ?? 'capabilities unavailable'}</span></div>)}<button className="btn btn-secondary btn-sm" onClick={() => void refresh()}>Refresh</button></div>;
};
export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'chat' | 'dashboard' | 'capabilities' | 'allowlist' | 'tasks' | 'logs' | 'settings'
  >('dashboard');

  const {
    device,
    connectionStatus,
    lastConnectedAt,
    capabilities,
    toggleCapability,
    allowedRoots,
    addAllowedRoot,
    removeAllowedRoot,
    tasks,
    updateTask,
    logs,
    clearLogs,
    serverUrl,
    setServerUrl,
    authToken,
    setAuthToken,
    syncDeviceIdentity,
    connectToServer,
    disconnectFromServer,
  } = useAgentStore();

  useEffect(() => {
    void syncDeviceIdentity();
  }, [syncDeviceIdentity]);

  const [newPathInput, setNewPathInput] = useState('');
  const [testPathInput, setTestPathInput] = useState('');
  const [testResult, setTestResult] = useState<{ allowed: boolean; message: string } | null>(null);

  const activeCapsCount = Object.values(capabilities).filter(Boolean).length;

  const handleAddPath = () => {
    if (!newPathInput.trim()) return;
    try {
      addAllowedRoot(newPathInput.trim());
      setNewPathInput('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Gagal menambahkan path');
    }
  };

  const handleTestPath = () => {
    if (!testPathInput.trim()) return;
    const isAllowed = allowedRoots.some(
      (root) =>
        testPathInput.trim() === root ||
        testPathInput.trim().startsWith(root.endsWith('\\') ? root : root + '\\'),
    );
    setTestResult({
      allowed: isAllowed,
      message: isAllowed
        ? `Path diizinkan (berada di dalam allowlist)`
        : `Path DITOLAK (berada di luar semua folder yang diizinkan)`,
    });
  };

  return (
    <div className="agent-container">
      {/* Header */}
      <header className="agent-header">
        <div className="brand-section">
          <span className="brand-logo">🪟</span>
          <div>
            <h1 className="brand-title">Personal AI OS — Windows Agent</h1>
            <span className="device-badge">ID: {device.id}</span>
          </div>
        </div>

        <div className="header-status-section">
          <div className="status-pill">
            <span className={`status-dot ${connectionStatus}`} />
            <span style={{ textTransform: 'capitalize' }}>{connectionStatus}</span>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="nav-tabs">
        <button className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => setActiveTab('chat')}>Chat</button>
        <button
          className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`tab-btn ${activeTab === 'capabilities' ? 'active' : ''}`}
          onClick={() => setActiveTab('capabilities')}
        >
          Capabilities ({activeCapsCount}/7)
        </button>
        <button
          className={`tab-btn ${activeTab === 'allowlist' ? 'active' : ''}`}
          onClick={() => setActiveTab('allowlist')}
        >
          Path Allowlist ({allowedRoots.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          Local Tasks ({tasks.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          Diagnostics Logs
        </button>
        <button
          className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="agent-content">
        {activeTab === 'chat' && <ChatPanel />}
        {activeTab === 'dashboard' && (
          <div className="grid-2">
            <div className="card">
              <h2 className="card-title">Status Sistem & Koneksi</h2>
              <p className="card-subtitle">
                Koneksi WSS Outbound ke Control Plane VPS (Tanpa Port Masuk Terbuka)
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Status Koneksi:</span>
                  <strong
                    style={{
                      color: `var(--status-${connectionStatus})`,
                      textTransform: 'capitalize',
                    }}
                  >
                    {connectionStatus}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Server Target:</span>
                  <code>{serverUrl}</code>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Perangkat:</span>
                  <span>
                    {device.name} ({device.arch})
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Terakhir Terhubung:</span>
                  <span>
                    {lastConnectedAt
                      ? new Date(lastConnectedAt).toLocaleTimeString()
                      : 'Belum pernah'}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  {connectionStatus === 'connected' ? (
                    <button className="btn btn-danger btn-sm" onClick={disconnectFromServer}>
                      Putuskan Koneksi WSS
                    </button>
                  ) : connectionStatus === 'connecting' || connectionStatus === 'reconnecting' ? (
                    <button className="btn btn-secondary btn-sm" onClick={disconnectFromServer}>
                      Batalkan ({connectionStatus})
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void connectToServer()}
                    >
                      Hubungkan WSS Outbound
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <h2 className="card-title">Ringkasan Keamanan & Sandbox</h2>
              <p className="card-subtitle">Prinsip Least-Privilege & Validasi Ganda</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Capability Aktif:</span>
                  <strong
                    style={{
                      color: activeCapsCount > 0 ? 'var(--accent-cyan)' : 'var(--text-sub)',
                    }}
                  >
                    {activeCapsCount} dari 7 aktif
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Folder Terdaftar:</span>
                  <strong>{allowedRoots.length} direktori</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Default Policy:</span>
                  <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                    DEFAULT OFF (Strict Deny)
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Proteksi Path Traversal:</span>
                  <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                    AKTIF (Canonical check)
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'capabilities' && (
          <div className="card">
            <h2 className="card-title">Registry Kemampuan (Capability Registry)</h2>
            <p className="card-subtitle">
              Sesuai aturan keamanan: Setiap kemampuan <strong>DEFAULT OFF</strong> dan harus
              dinyalakan secara sadar.
            </p>

            <div style={{ marginTop: 16 }}>
              {(
                [
                  {
                    name: 'filesystem',
                    desc: 'Akses baca, tulis, dan daftar folder dalam allowlist',
                    warning: false,
                  },
                  {
                    name: 'powershell',
                    desc: 'Eksekusi perintah terminal PowerShell lokal',
                    warning: false,
                  },
                  {
                    name: 'git',
                    desc: 'Operasi Git version control pada repositori',
                    warning: false,
                  },
                  { name: 'browser', desc: 'Automasi browser lokal / Playwright', warning: false },
                  {
                    name: 'screenshot',
                    desc: 'Ambil tangkapan layar desktop Windows',
                    warning: false,
                  },
                  {
                    name: 'vscode',
                    desc: 'Integrasi editor VS Code (hanya jika diaktifkan eksplisit)',
                    warning: true,
                  },
                  {
                    name: 'docker',
                    desc: 'Operasi container Docker lokal (hanya jika diaktifkan eksplisit)',
                    warning: true,
                  },
                ] as const
              ).map((cap) => {
                const isEnabled = capabilities[cap.name] ?? false;
                return (
                  <div key={cap.name} className="capability-row">
                    <div className="capability-info">
                      <span className="capability-name">{cap.name}</span>
                      <span className="capability-desc">{cap.desc}</span>
                      {cap.warning && (
                        <span className="optin-warning">
                          ⚠️ Memerlukan izin eksplisit tingkat tinggi
                        </span>
                      )}
                    </div>

                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => toggleCapability(cap.name, e.target.checked)}
                      />
                      <span className="slider" />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'allowlist' && (
          <div className="card">
            <h2 className="card-title">Daftar Folder Diizinkan (Path Allowlist)</h2>
            <p className="card-subtitle">
              Hanya direktori yang didaftarkan di sini yang dapat diakses oleh agent. Percobaan
              traversal (seperti ../) akan ditolak.
            </p>

            <div className="input-row">
              <input
                type="text"
                className="text-input"
                placeholder="Contoh: C:\Coding\Project\my-app"
                value={newPathInput}
                onChange={(e) => setNewPathInput(e.target.value)}
              />
              <button className="btn btn-primary" onClick={handleAddPath}>
                + Tambah Folder
              </button>
            </div>

            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 13, marginBottom: 8, color: 'var(--text-muted)' }}>
                Folder Terdaftar:
              </h3>
              {allowedRoots.length === 0 ? (
                <p style={{ color: 'var(--text-sub)', fontStyle: 'italic', padding: 8 }}>
                  Belum ada folder yang diizinkan. Semua akses filesystem akan ditolak.
                </p>
              ) : (
                allowedRoots.map((root) => (
                  <div
                    key={root}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'var(--bg-secondary)',
                      borderRadius: 6,
                      marginBottom: 6,
                    }}
                  >
                    <code style={{ fontSize: 12 }}>{root}</code>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => removeAllowedRoot(root)}
                    >
                      Hapus
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Test Sandbox */}
            <div
              style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}
            >
              <h3 style={{ fontSize: 13, marginBottom: 4 }}>Uji Keamanan Path</h3>
              <p style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 8 }}>
                Verifikasi apakah path atau upaya path traversal akan ditolak oleh sistem.
              </p>
              <div className="input-row">
                <input
                  type="text"
                  className="text-input"
                  placeholder="Contoh: C:\Coding\Project\my-app\..\..\Windows\System32"
                  value={testPathInput}
                  onChange={(e) => setTestPathInput(e.target.value)}
                />
                <button className="btn btn-primary" onClick={handleTestPath}>
                  Uji Validasi
                </button>
              </div>
              {testResult && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: testResult.allowed
                      ? 'rgba(16, 185, 129, 0.1)'
                      : 'rgba(244, 63, 94, 0.1)',
                    border: `1px solid ${testResult.allowed ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
                    color: testResult.allowed ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {testResult.message}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="card">
            <h2 className="card-title">Daftar Perintah & Tugas Lokal (Local Tasks)</h2>
            <p className="card-subtitle">
              Perintah yang didelegasikan dari Control Plane ke workstation Windows ini.
            </p>

            {tasks.length === 0 ? (
              <p
                style={{
                  color: 'var(--text-sub)',
                  fontStyle: 'italic',
                  padding: 24,
                  textAlign: 'center',
                }}
              >
                Belum ada task yang dieksekusi secara lokal.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    style={{
                      background: 'var(--bg-secondary)',
                      padding: 14,
                      borderRadius: 8,
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                        {task.id}
                      </span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 10,
                            fontWeight: 600,
                            background:
                              task.status === 'completed'
                                ? 'rgba(16, 185, 129, 0.2)'
                                : task.status === 'running'
                                  ? 'rgba(6, 182, 212, 0.2)'
                                  : 'rgba(244, 63, 94, 0.2)',
                            color:
                              task.status === 'completed'
                                ? 'var(--accent-emerald)'
                                : task.status === 'running'
                                  ? 'var(--accent-cyan)'
                                  : 'var(--accent-rose)',
                          }}
                        >
                          {task.status.toUpperCase()}
                        </span>

                        {task.status === 'running' && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => updateTask(task.id, { status: 'cancelled' })}
                          >
                            Batalkan
                          </button>
                        )}
                      </div>
                    </div>

                    <pre
                      style={{
                        margin: '8px 0',
                        padding: 8,
                        background: '#070a0f',
                        borderRadius: 4,
                        fontSize: 11,
                        color: 'var(--text-main)',
                      }}
                    >
                      {task.command}
                    </pre>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        color: 'var(--text-sub)',
                      }}
                    >
                      <span>CWD: {task.cwd}</span>
                      <span>{task.durationMs ? `${task.durationMs}ms` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <h2 className="card-title" style={{ margin: 0 }}>
                Log Diagnostik & Audit
              </h2>
              <button className="btn btn-danger btn-sm" onClick={clearLogs}>
                Bersihkan Log
              </button>
            </div>

            <div className="log-stream">
              {logs.length === 0 ? (
                <div style={{ color: 'var(--text-sub)', textAlign: 'center', paddingTop: 40 }}>
                  Belum ada log tercatat.
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="log-entry">
                    <span className="log-time">
                      [{new Date(log.timestamp).toLocaleTimeString()}]
                    </span>
                    <span className={`log-level ${log.level}`}>{log.level.toUpperCase()}</span>
                    <span className="log-text">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <>
          <div className="card" style={{ maxWidth: 600 }}>
            <h2 className="card-title">Pengaturan Agen & Server</h2>
            <p className="card-subtitle">
              Konfigurasi endpoint WSS VPS dan token autentikasi perangkat.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  URL Control Plane VPS (HTTP/HTTPS):
                </label>
                <input
                  type="text"
                  className="text-input"
                  style={{ width: '100%', marginTop: 4 }}
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Device Access Token (JWT):
                </label>
                <input
                  type="password"
                  className="text-input"
                  style={{ width: '100%', marginTop: 4 }}
                  placeholder="Masukkan access token user..."
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                />
              </div>

              <div
                style={{
                  paddingTop: 12,
                  borderTop: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>
                  Perangkat ini akan terhubung via WSS Outbound ke endpoint /v1/agent/ws.
                </span>
                {connectionStatus === 'connected' ? (
                  <button className="btn btn-danger btn-sm" onClick={disconnectFromServer}>
                    Putuskan WSS
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => void connectToServer()}>
                    Hubungkan Sekarang
                  </button>
                )}
              </div>
            </div>
          </div>
          <ModelSettings />
          </>
        )}
      </main>
    </div>
  );
};
