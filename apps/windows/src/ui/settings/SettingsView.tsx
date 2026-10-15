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
} from 'lucide-react';
import { useAgentStore } from '../context.ts';
import type { CapabilityName } from '../../security/capability-registry.ts';
import { ThemeSwitcher } from '../components/ThemeSwitcher.tsx';
import { Button } from '../components/Button.tsx';
import { Dialog } from '../components/Dialog.tsx';
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
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

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
                        <code>{rootPath}</code>
                        <button
                          type="button"
                          className="ui-btn ui-btn-danger ui-btn-sm"
                          onClick={() => removeAllowedRoot(rootPath)}
                        >
                          <Trash2 size={12} className="conversation-item-icon" />
                          <span>{idID.settings.device.removePathButton}</span>
                        </button>
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

              {modelCatalogStatus && (
                <span className="settings-hint">{modelCatalogStatus}</span>
              )}

              <div className="settings-capability-list">
                {models.map((model) => (
                  <div key={model.id} className="activity-card">
                    <div className="card-header-row">
                      <strong className="card-title-text">{model.id}</strong>
                      <span className="status-pill running">{model.provider}</span>
                    </div>
                    <div className="card-meta-row">
                      <span>{idID.settings.models.capabilitiesLabel}</span>
                      <span>{model.capabilities?.join(', ') || idID.settings.models.noCapabilities}</span>
                    </div>
                  </div>
                ))}
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
