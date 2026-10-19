import React, { useState, useEffect } from 'react';
import {
  User,
  Shield,
  Cpu,
  Palette,
  Laptop,
  Terminal,
  FolderPlus,
  Trash2,
  RefreshCw,
  LogOut,
  AlertTriangle,
  Star,
  Zap,
  Wrench,
  Eye,
  Layers,
  Clock,
  HelpCircle,
  Copy,
  Check,
} from 'lucide-react';
import { useAgentStore } from '../context.ts';
import type { CapabilityName } from '../../security/capability-registry.ts';
import { ThemeSwitcher } from '../components/ThemeSwitcher.tsx';
import { Button } from '../components/Button.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { StatusDot } from '../components/StatusDot.tsx';
import { idID } from '../locales/id-ID.ts';

const useDebounced = (value: string, delayMs = 400): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

export const SettingsView: React.FC = () => {
  const {
    userEmail,
    googleLogin,
    logout,
    device,
    capabilities,
    toggleCapability,
    allowedRoots,
    addAllowedRoot,
    removeAllowedRoot,
    models,
    refreshModels,
    modelCatalogStatus,
    modelCatalogUnavailable,
    modelCatalogError,
    favoriteModels,
    toggleFavoriteModel,
    userDefaultModel,
    setUserDefaultModel,
    closeToTray,
    setCloseToTray,
    autostart,
    setAutostart,
    serverUrl,
    setServerUrl,
    authToken,
    setAuthToken,
    connectionStatus,
    connectToServer,
    disconnectFromServer,
    logs,
    clearLogs,
  } = useAgentStore();

  const [activeSection, setActiveSection] = useState<
    'account' | 'device' | 'models' | 'appearance' | 'system' | 'advanced'
  >('account');

  const [newPathInput, setNewPathInput] = useState('');
  const [addPathError, setAddPathError] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  const handleCopyPath = (path: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    }
  };

  // Settings drafts
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl);
  const [authTokenDraft, setAuthTokenDraft] = useState(authToken);
  const debouncedServerUrl = useDebounced(serverUrlDraft);
  const debouncedAuthToken = useDebounced(authTokenDraft);

  useEffect(() => {
    setServerUrl(debouncedServerUrl);
  }, [debouncedServerUrl, setServerUrl]);

  useEffect(() => {
    setAuthToken(debouncedAuthToken);
  }, [debouncedAuthToken, setAuthToken]);

  useEffect(() => {
    void refreshModels();
  }, [serverUrl, authToken, refreshModels]);

  const handleAddPath = () => {
    if (!newPathInput.trim()) return;
    setAddPathError(null);
    try {
      addAllowedRoot(newPathInput.trim());
      setNewPathInput('');
    } catch (err) {
      setAddPathError(err instanceof Error ? err.message : 'Gagal menambahkan direktori');
    }
  };

  const capabilityList: Array<{ name: CapabilityName; warning?: boolean }> = [
    { name: 'filesystem' },
    { name: 'powershell' },
    { name: 'git' },
    { name: 'browser' },
    { name: 'screenshot' },
    { name: 'vscode', warning: true },
    { name: 'docker', warning: true },
  ];

  return (
    <div className="settings-container">
      {/* Settings Header */}
      <div className="settings-header">
        <h1 className="settings-title">{idID.settings.title}</h1>
        <p className="settings-subtitle">{idID.settings.subtitle}</p>
      </div>

      {/* Settings Body with Navigation Tabs on Left, Content on Right */}
      <div className="settings-grid">
        {/* Navigation List */}
        <nav className="settings-nav" aria-label="Navigasi Pengaturan">
          <button
            type="button"
            className={`settings-nav-btn ${activeSection === 'account' ? 'active' : ''}`}
            onClick={() => setActiveSection('account')}
          >
            <User size={15} />
            <span>{idID.settings.sections.account}</span>
          </button>

          <button
            type="button"
            className={`settings-nav-btn ${activeSection === 'device' ? 'active' : ''}`}
            onClick={() => setActiveSection('device')}
          >
            <Shield size={15} />
            <span>{idID.settings.sections.devicePermissions}</span>
          </button>

          <button
            type="button"
            className={`settings-nav-btn ${activeSection === 'models' ? 'active' : ''}`}
            onClick={() => setActiveSection('models')}
          >
            <Cpu size={15} />
            <span>{idID.settings.sections.models}</span>
          </button>

          <button
            type="button"
            className={`settings-nav-btn ${activeSection === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveSection('appearance')}
          >
            <Palette size={15} />
            <span>{idID.settings.sections.appearance}</span>
          </button>

          <button
            type="button"
            className={`settings-nav-btn ${activeSection === 'system' ? 'active' : ''}`}
            onClick={() => setActiveSection('system')}
          >
            <Laptop size={15} />
            <span>{idID.settings.sections.system}</span>
          </button>

          <button
            type="button"
            className={`settings-nav-btn ${activeSection === 'advanced' ? 'active' : ''}`}
            onClick={() => setActiveSection('advanced')}
          >
            <Terminal size={15} />
            <span>{idID.settings.sections.advanced}</span>
          </button>
        </nav>

        {/* Content Pane */}
        <div className="settings-content-scroll">
          {/* Section 1: Account */}
          {activeSection === 'account' && (
            <div className="settings-card">
              <div className="settings-card-header">
                <h2 className="settings-card-title">{idID.settings.sections.account}</h2>
              </div>

              <div className="settings-form-group">
                <span className="settings-label">{idID.settings.account.emailLabel}</span>
                <strong className="card-title-text">
                  {userEmail || idID.settings.account.notLoggedIn}
                </strong>
              </div>

              <div>
                {userEmail ? (
                  <Button variant="danger" size="sm" onClick={() => setLogoutDialogOpen(true)}>
                    <LogOut size={14} className="conversation-item-icon" />
                    <span>{idID.settings.account.logout}</span>
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => void googleLogin()}>
                    {idID.settings.account.loginGoogle}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Section 2: Device & Permissions */}
          {activeSection === 'device' && (
            <div className="settings-card">
              {/* Device ID info */}
              <div className="settings-form-group">
                <span className="settings-label">{idID.settings.device.idLabel}</span>
                <code>{device.id || idID.settings.device.unregistered}</code>
              </div>

              {/* Capability Toggles */}
              <div className="settings-form-group">
                <h2 className="settings-card-title">{idID.settings.device.capabilityTitle}</h2>
                <p className="settings-card-subtitle">{idID.settings.device.capabilitySubtitle}</p>

                <div className="settings-capability-list">
                  {capabilityList.map((cap) => {
                    const info = idID.settings.device.capabilities[cap.name];
                    const isEnabled = Boolean(capabilities[cap.name]);
                    return (
                      <div key={cap.name} className="settings-capability-item">
                        <div className="settings-toggle-info">
                          <div className="conversation-item-inner">
                            <strong className="settings-toggle-title">{info.label}</strong>
                            {cap.warning && (
                              <span className="risk-pill medium">
                                <AlertTriangle size={11} className="flex-shrink-0" />
                                <span>Perhatian</span>
                              </span>
                            )}
                          </div>
                          <span className="settings-hint">{info.desc}</span>
                        </div>

                        <label className="settings-toggle-row">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(e) => toggleCapability(cap.name, e.target.checked)}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Path Allowlist */}
              <div className="settings-form-group">
                <h2 className="settings-card-title">{idID.settings.device.allowedRootsTitle}</h2>
                <p className="settings-card-subtitle">{idID.settings.device.allowedRootsSubtitle}</p>

                <div className="chat-error-actions">
                  <input
                    type="text"
                    className="sidebar-search-input"
                    placeholder={idID.settings.device.addPathPlaceholder}
                    value={newPathInput}
                    onChange={(e) => setNewPathInput(e.target.value)}
                  />
                  <Button variant="primary" size="sm" onClick={handleAddPath}>
                    <FolderPlus size={14} className="conversation-item-icon" />
                    <span>{idID.settings.device.addPathButton}</span>
                  </Button>
                </div>

                {addPathError && (
                  <span className="chat-error-text">{addPathError}</span>
                )}

                <div className="settings-roots-list">
                  {allowedRoots.length === 0 ? (
                    <div className="sidebar-empty-state">
                      {idID.settings.device.noPaths}
                    </div>
                  ) : (
                    allowedRoots.map((rootPath) => (
                      <div key={rootPath} className="settings-root-item">
                        <code className="settings-root-path-code" title={rootPath}>{rootPath}</code>
                        <div className="settings-root-actions">
                          <button
                            type="button"
                            className="ui-btn ui-btn-secondary ui-btn-sm"
                            onClick={() => handleCopyPath(rootPath)}
                            title="Salin path direktori"
                          >
                            {copiedPath === rootPath ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copiedPath === rootPath ? 'Tersalin!' : 'Salin'}</span>
                          </button>
                          <button
                            type="button"
                            className="ui-btn ui-btn-danger ui-btn-sm"
                            onClick={() => removeAllowedRoot(rootPath)}
                          >
                            <Trash2 size={12} className="conversation-item-icon" />
                            <span>{idID.settings.device.removePathButton}</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Section 3: Models */}
          {activeSection === 'models' && (
            <div className="settings-card">
              <div className="card-header-row">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">{idID.settings.models.title}</h2>
                  <p className="settings-card-subtitle">{idID.settings.models.subtitle(models.length)}</p>
                </div>
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary ui-btn-sm"
                  onClick={() => void refreshModels()}
                >
                  <RefreshCw size={12} className="conversation-item-icon" />
                  <span>{idID.settings.models.refresh}</span>
                </button>
              </div>

              {modelCatalogUnavailable && (
                <div className="model-popover-alert model-catalog-alert" role="alert">
                  <span className="model-alert-text">
                    {modelCatalogError || 'Katalog model tidak dapat dihubungi (503).'}
                  </span>
                  <button
                    type="button"
                    className="model-alert-retry"
                    onClick={() => void refreshModels()}
                  >
                    <RefreshCw size={11} />
                    <span>Coba lagi</span>
                  </button>
                </div>
              )}

              {modelCatalogStatus && !modelCatalogUnavailable && (
                <span className="settings-hint">{modelCatalogStatus}</span>
              )}

              <div className="settings-capability-list">
                {models.map((model) => {
                  const isFav = favoriteModels.includes(model.id);
                  const isDefault = userDefaultModel === model.id || model.isDefault;
                  const details = model.capabilityDetails;
                  const isStream = details?.streaming?.status === 'probed' || model.capabilities?.includes('streaming');
                  const isTool = details?.tool_calling?.status === 'probed' || model.capabilities?.includes('tool_calling');
                  const isVision = details?.vision?.status === 'probed' || model.capabilities?.includes('vision');
                  const hasUnknown = details && (details.streaming?.status === 'unknown' || details.tool_calling?.status === 'unknown' || details.vision?.status === 'unknown');

                  return (
                    <div key={model.id} className="activity-card model-settings-card">
                      <div className="card-header-row">
                        <div className="model-settings-title-row">
                          <strong className="card-title-text">{model.id}</strong>
                          {isDefault && (
                            <span className="model-default-badge">Default Akun</span>
                          )}
                        </div>
                        <div className="model-settings-actions-row">
                          <button
                            type="button"
                            className="model-action-icon-btn"
                            onClick={() => toggleFavoriteModel(model.id)}
                            title={isFav ? 'Hapus favorit' : 'Sematkan favorit'}
                          >
                            <Star size={14} fill={isFav ? 'var(--color-warning)' : 'none'} color={isFav ? 'var(--color-warning)' : 'var(--text-sub)'} />
                          </button>
                          {!isDefault && (
                            <button
                              type="button"
                              className="model-set-default-btn"
                              onClick={() => void setUserDefaultModel(model.id)}
                              title="Jadikan model default untuk semua percakapan"
                            >
                              Jadikan Default
                            </button>
                          )}
                          <span className="status-pill running">{model.provider}</span>
                        </div>
                      </div>

                      <div className="model-badges-row">
                        {isStream && (
                          <span className="model-cap-badge verified">
                            <Zap size={10} />
                            <span>Streaming</span>
                          </span>
                        )}
                        {isTool && (
                          <span className="model-cap-badge verified">
                            <Wrench size={10} />
                            <span>Tools</span>
                          </span>
                        )}
                        {isVision && (
                          <span className="model-cap-badge verified">
                            <Eye size={10} />
                            <span>Vision</span>
                          </span>
                        )}
                        {hasUnknown && (
                          <span className="model-cap-badge unknown">
                            <HelpCircle size={10} />
                            <span>Unknown</span>
                          </span>
                        )}
                        {model.contextWindow && (
                          <span className="model-cap-badge context">
                            <Layers size={10} />
                            <span>{model.contextWindow.toLocaleString()} token</span>
                          </span>
                        )}
                        {typeof model.lastLatencyMs === 'number' && model.lastLatencyMs > 0 && (
                          <span className="model-cap-badge latency">
                            <Clock size={10} />
                            <span>{model.lastLatencyMs} ms</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 4: Appearance */}
          {activeSection === 'appearance' && (
            <div className="settings-card">
              <div className="settings-card-header">
                <h2 className="settings-card-title">{idID.settings.appearance.title}</h2>
                <p className="settings-card-subtitle">{idID.settings.appearance.subtitle}</p>
              </div>

              <div className="card-header-row">
                <span className="settings-label">{idID.settings.appearance.themeLabel}</span>
                <ThemeSwitcher />
              </div>
            </div>
          )}

          {/* Section 5: Windows System Integration */}
          {activeSection === 'system' && (
            <div className="settings-card">
              <div className="settings-card-header">
                <h2 className="settings-card-title">{idID.settings.system.title}</h2>
                <p className="settings-card-subtitle">{idID.settings.system.subtitle}</p>
              </div>

              <div className="settings-form-group">
                <label className="settings-toggle-row">
                  <input
                    type="checkbox"
                    checked={closeToTray}
                    onChange={(e) => void setCloseToTray(e.target.checked)}
                  />
                  <div className="settings-toggle-info">
                    <span className="settings-toggle-title">
                      {idID.settings.system.closeToTray}
                    </span>
                    <p className="settings-toggle-desc">
                      {idID.settings.system.closeToTrayDesc}
                    </p>
                  </div>
                </label>

                <label className="settings-toggle-row">
                  <input
                    type="checkbox"
                    checked={autostart}
                    onChange={(e) => void setAutostart(e.target.checked)}
                  />
                  <div className="settings-toggle-info">
                    <span className="settings-toggle-title">
                      {idID.settings.system.autostart}
                    </span>
                    <p className="settings-toggle-desc">
                      {idID.settings.system.autostartDesc}
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Section 6: Advanced & Diagnostics */}
          {activeSection === 'advanced' && (
            <div className="settings-card">
              <div className="settings-card-header">
                <h2 className="settings-card-title">{idID.settings.sections.advanced}</h2>
              </div>

              <div className="settings-form-group">
                <label className="settings-label">
                  {idID.settings.advanced.serverUrlLabel}
                </label>
                <input
                  type="text"
                  className="sidebar-search-input"
                  value={serverUrlDraft}
                  onChange={(e) => setServerUrlDraft(e.target.value)}
                />
              </div>

              <div className="settings-form-group">
                <label className="settings-label">
                  {idID.settings.advanced.manualTokenLabel}
                </label>
                <input
                  type="password"
                  className="sidebar-search-input"
                  placeholder={idID.settings.advanced.manualTokenPlaceholder}
                  value={authTokenDraft}
                  onChange={(e) => setAuthTokenDraft(e.target.value)}
                />
              </div>

              <div className="card-header-row">
                <span className="settings-hint">
                  {idID.settings.advanced.connectNotice}
                </span>
                {connectionStatus === 'connected' ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn-danger ui-btn-sm"
                    onClick={disconnectFromServer}
                  >
                    {idID.settings.advanced.disconnectWss}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary ui-btn-sm"
                    onClick={() => void connectToServer()}
                  >
                    {idID.settings.advanced.connectWss}
                  </button>
                )}
              </div>

              {/* System Health Status Cards */}
              <div className="settings-form-group">
                <h3 className="card-title-text">Kesehatan Sistem & Layanan</h3>
                <div className="settings-health-grid">
                  <div className="settings-health-card">
                    <div className="settings-health-header">
                      <span className="settings-health-label">API Gateway VPS</span>
                      <StatusDot status={connectionStatus === 'connected' ? 'connected' : connectionStatus === 'connecting' ? 'connecting' : 'disconnected'} />
                    </div>
                    <span className="settings-health-val">
                      {connectionStatus === 'connected' ? 'Terhubung (200 OK)' : connectionStatus === 'connecting' ? 'Menghubungkan...' : 'Terputus'}
                    </span>
                    <span className="settings-health-sub">{serverUrl}</span>
                  </div>

                  <div className="settings-health-card">
                    <div className="settings-health-header">
                      <span className="settings-health-label">Event Stream (WSS)</span>
                      <StatusDot status={connectionStatus === 'connected' ? 'connected' : 'disconnected'} />
                    </div>
                    <span className="settings-health-val">
                      {connectionStatus === 'connected' ? 'Aktif' : 'Terputus'}
                    </span>
                    <span className="settings-health-sub">/v1/events realtime</span>
                  </div>

                  <div className="settings-health-card">
                    <div className="settings-health-header">
                      <span className="settings-health-label">Worker Windows</span>
                      <StatusDot status={device.id ? 'connected' : 'disconnected'} />
                    </div>
                    <span className="settings-health-val">
                      {device.id ? 'Terdaftar & Siap' : 'Belum Terdaftar'}
                    </span>
                    <span className="settings-health-sub">{device.name || 'Personal PC'}</span>
                  </div>
                </div>
              </div>

              {/* Diagnostic Logs */}
              <div className="settings-form-group">
                <div className="card-header-row">
                  <h3 className="card-title-text">{idID.settings.advanced.logsTitle}</h3>
                  <button
                    type="button"
                    className="ui-btn ui-btn-danger ui-btn-sm"
                    onClick={clearLogs}
                    disabled={logs.length === 0}
                  >
                    {idID.settings.advanced.clearLogs}
                  </button>
                </div>

                <div className="settings-log-stream">
                  {logs.length === 0 ? (
                    <div className="sidebar-empty-state">
                      {idID.settings.advanced.noLogs}
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div key={log.id} className="settings-log-row">
                        <span className="settings-log-time">
                          [{new Date(log.timestamp).toLocaleTimeString()}]
                        </span>
                        <span className={`settings-log-level ${log.level}`}>
                          {log.level.toUpperCase()}
                        </span>
                        <span className="settings-log-msg">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Logout Confirmation Dialog */}
      <Dialog
        isOpen={logoutDialogOpen}
        onClose={() => setLogoutDialogOpen(false)}
        title={idID.settings.account.logout}
      >
        <div className="settings-form-group">
          <p className="settings-card-subtitle">
            {idID.settings.account.logoutConfirm}
          </p>
          <div className="approval-action-btns">
            <Button variant="secondary" size="sm" onClick={() => setLogoutDialogOpen(false)}>
              {idID.common.cancel}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setLogoutDialogOpen(false);
                void logout();
              }}
            >
              {idID.settings.account.logout}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
