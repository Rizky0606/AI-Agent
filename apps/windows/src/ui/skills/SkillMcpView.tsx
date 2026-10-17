import React, { useState, useEffect, useMemo } from 'react';
import {
  Wrench,
  Server,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Plus,
  Trash2,
  FileCode,
  Info,
  Terminal,
  Globe,
  Radio,
} from 'lucide-react';
import { useAgentStore } from '../context.ts';
import { Button } from '../components/Button.tsx';
import { IconButton } from '../components/IconButton.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { useToast } from '../components/Toast.tsx';
import { idID } from '../locales/id-ID.ts';
import './SkillMcpView.css';

export const SkillMcpView: React.FC = () => {
  const {
    skills,
    skillsLoading,
    skillsError,
    fetchSkills,
    toggleProjectSkill,
    fetchSkillManifest,
    mcpServers,
    mcpLogs,
    mcpLoading,
    mcpError,
    fetchMcpServers,
    fetchMcpLogs,
    addMcpServer,
    deleteMcpServer,
    conversations,
    skillProposals,
    skillProposalsLoading,
    fetchSkillProposals,
    approveSkillProposal,
    rejectSkillProposal,
  } = useAgentStore();

  const { success, error: toastError, info } = useToast();

  const [activeTab, setActiveTab] = useState<'skills' | 'mcp' | 'proposals'>('skills');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Rejection dialog state
  const [rejectDialog, setRejectDialog] = useState<{
    open: boolean;
    proposalId: string | null;
    reason: string;
  }>({
    open: false,
    proposalId: null,
    reason: '',
  });

  // Manifest modal state
  const [manifestModal, setManifestModal] = useState<{
    open: boolean;
    skillName: string;
    manifest: Record<string, unknown> | null;
  }>({
    open: false,
    skillName: '',
    manifest: null,
  });

  // Add MCP server modal state
  const [isAddMcpOpen, setIsAddMcpOpen] = useState(false);
  const [addMcpData, setAddMcpData] = useState<{
    id: string;
    name: string;
    transport: 'stdio' | 'sse';
    command: string;
    args: string;
    url: string;
    capabilities: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    error: string | null;
  }>({
    id: '',
    name: '',
    transport: 'stdio',
    command: 'npx',
    args: '',
    url: '',
    capabilities: 'docs:read',
    riskLevel: 'MEDIUM',
    error: null,
  });

  // Unique project IDs from conversations
  const projectList = useMemo(() => {
    const set = new Set<string>();
    conversations.forEach((c) => {
      if (c.projectId) set.add(c.projectId);
    });
    return Array.from(set);
  }, [conversations]);

  // Load skills, MCP, or proposals on mount/tab change
  useEffect(() => {
    if (activeTab === 'skills') {
      void fetchSkills(selectedProjectId || undefined);
    } else if (activeTab === 'mcp') {
      void fetchMcpServers();
      void fetchMcpLogs();
    } else if (activeTab === 'proposals') {
      void fetchSkillProposals();
    }
  }, [activeTab, selectedProjectId, fetchSkills, fetchMcpServers, fetchMcpLogs, fetchSkillProposals]);

  const handleApproveProposal = async (id: string) => {
    try {
      await approveSkillProposal(id);
      success('Usulan skill disetujui! Skill baru dibuat dalam keadaan NONAKTIF. Anda dapat mengaktifkannya di tab Keterampilan.');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Gagal menyetujui usulan skill.');
    }
  };

  const handleRejectProposalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectDialog.proposalId) return;
    try {
      await rejectSkillProposal(rejectDialog.proposalId, rejectDialog.reason.trim() || 'Ditolak oleh pengguna.');
      success('Usulan skill berhasil ditolak.');
      setRejectDialog({ open: false, proposalId: null, reason: '' });
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Gagal menolak usulan skill.');
    }
  };

  const handleToggleSkill = async (skillName: string, currentEnabled: boolean, isReadOnly?: boolean) => {
    if (isReadOnly) {
      info(idID.skillsMcp.skillsSection.readOnlyBadge + ' tidak dapat diubah.');
      return;
    }
    const targetProject = selectedProjectId || 'default';
    try {
      await toggleProjectSkill(targetProject, skillName, !currentEnabled);
      success(`Skill '${skillName}' berhasil di${!currentEnabled ? 'aktifkan' : 'nonaktifkan'}.`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Gagal mengubah status skill.');
    }
  };

  const handleOpenManifest = async (skillName: string) => {
    const manifest = await fetchSkillManifest(skillName);
    if (manifest) {
      setManifestModal({ open: true, skillName, manifest });
    } else {
      toastError(`Gagal membaca manifest untuk ${skillName}.`);
    }
  };

  const handleAddMcpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddMcpData((prev) => ({ ...prev, error: null }));

    if (!addMcpData.id.trim() || !addMcpData.name.trim()) {
      setAddMcpData((prev) => ({ ...prev, error: 'ID dan Nama server wajib diisi.' }));
      return;
    }

    try {
      const caps = addMcpData.capabilities
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (addMcpData.transport === 'stdio') {
        const argsArray = addMcpData.args.trim() ? addMcpData.args.split(/\s+/) : [];
        await addMcpServer({
          id: addMcpData.id.trim(),
          name: addMcpData.name.trim(),
          transport: 'stdio',
          command: addMcpData.command.trim(),
          args: argsArray,
          allowedCapabilities: caps,
          riskLevel: addMcpData.riskLevel,
        });
      } else {
        if (!addMcpData.url.trim()) {
          setAddMcpData((prev) => ({ ...prev, error: 'URL remote SSE wajib diisi.' }));
          return;
        }
        await addMcpServer({
          id: addMcpData.id.trim(),
          name: addMcpData.name.trim(),
          transport: 'sse',
          url: addMcpData.url.trim(),
          allowedCapabilities: caps,
          riskLevel: addMcpData.riskLevel,
        });
      }

      success(`Server MCP '${addMcpData.name}' berhasil didaftarkan!`);
      setIsAddMcpOpen(false);
      setAddMcpData({
        id: '',
        name: '',
        transport: 'stdio',
        command: 'npx',
        args: '',
        url: '',
        capabilities: 'docs:read',
        riskLevel: 'MEDIUM',
        error: null,
      });
      void fetchMcpServers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menambahkan server MCP.';
      setAddMcpData((prev) => ({ ...prev, error: msg }));
    }
  };

  const handleDeleteMcp = async (id: string, name: string) => {
    if (window.confirm(`${idID.skillsMcp.mcpSection.deleteConfirm}\n\nServer: ${name}`)) {
      try {
        await deleteMcpServer(id);
        success(`Server MCP '${name}' berhasil dihapus.`);
        void fetchMcpServers();
      } catch (err) {
        toastError(err instanceof Error ? err.message : 'Gagal menghapus server.');
      }
    }
  };

  return (
    <div className="skill-mcp-view">
      {/* View Header */}
      <div className="skill-mcp-header">
        <div className="skill-mcp-titles">
          <h1>
            <Wrench size={24} color="var(--color-primary, #3b82f6)" />
            {idID.skillsMcp.title}
          </h1>
          <p>{idID.skillsMcp.subtitle}</p>
        </div>

        {/* Tab Switcher */}
        <div className="skill-mcp-tabs">
          <button
            className={`skill-mcp-tab-btn ${activeTab === 'skills' ? 'active' : ''}`}
            onClick={() => setActiveTab('skills')}
          >
            <ShieldCheck size={16} />
            {idID.skillsMcp.tabs.skills}
          </button>
          <button
            className={`skill-mcp-tab-btn ${activeTab === 'mcp' ? 'active' : ''}`}
            onClick={() => setActiveTab('mcp')}
          >
            <Server size={16} />
            {idID.skillsMcp.tabs.mcp}
          </button>
          <button
            className={`skill-mcp-tab-btn ${activeTab === 'proposals' ? 'active' : ''}`}
            onClick={() => setActiveTab('proposals')}
          >
            <FileCode size={16} />
            {idID.skillsMcp.tabs.proposals}
            {skillProposals.filter((p) => p.status === 'pending').length > 0 && (
              <span className="activity-badge">
                {skillProposals.filter((p) => p.status === 'pending').length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Plain Language Risk Education Card */}
      <div className="risk-card">
        <div className="risk-card-header">
          <Info size={18} />
          <span>{idID.skillsMcp.riskEducation.title}</span>
        </div>
        <div className="risk-card-body">
          {idID.skillsMcp.riskEducation.description}
          <div className="risk-badges-row">
            <span className="risk-pill low">
              <ShieldCheck size={12} />
              RENDAH: {idID.skillsMcp.riskEducation.lowRisk}
            </span>
            <span className="risk-pill medium">
              <AlertCircle size={12} />
              SEDANG: {idID.skillsMcp.riskEducation.mediumRisk}
            </span>
            <span className="risk-pill high">
              <ShieldAlert size={12} />
              TINGGI/KRITIS: {idID.skillsMcp.riskEducation.highRisk}
            </span>
          </div>
        </div>
      </div>

      {/* SKILLS TAB CONTENT */}
      {activeTab === 'skills' && (
        <div className="skills-tab-content">
          {/* Toolbar */}
          <div className="skills-toolbar">
            <div className="project-select-label">
              <span>{idID.skillsMcp.skillsSection.projectSelectorLabel}</span>
              <select
                className="project-select"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                <option value="">{idID.skillsMcp.skillsSection.allSkillsScope}</option>
                {projectList.map((pid) => (
                  <option key={pid} value={pid}>
                    Proyek: {pid}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="secondary"
              size="sm"
              iconLeft={<RefreshCw size={14} className={skillsLoading ? 'spin' : ''} />}
              onClick={() => void fetchSkills(selectedProjectId || undefined)}
            >
              Segarkan
            </Button>
          </div>

          {skillsError && (
            <div className="callout callout-error skills-callout-error">
              {skillsError}
            </div>
          )}

          {/* Skills Grid */}
          <div className="skills-grid">
            {skills.map((skill) => {
              const isReadOnly = Boolean(skill.isReadOnly || skill.source === 'hermes');
              return (
                <div key={skill.id || skill.name} className="skill-card">
                  <div>
                    <div className="skill-card-top">
                      <div className="skill-title-block">
                        <div className="skill-title-row">
                          <h3>{skill.name}</h3>
                          <span className="skill-version-pill">v{skill.version}</span>
                        </div>
                        <span className="skill-source-badge">
                          {isReadOnly
                            ? idID.skillsMcp.skillsSection.readOnlyBadge
                            : skill.source === 'builtin'
                            ? idID.skillsMcp.skillsSection.builtinBadge
                            : idID.skillsMcp.skillsSection.workspaceBadge}
                        </span>
                      </div>
                      {skill.isProjectOverride && (
                        <span className="risk-pill medium skill-override-badge">
                          {idID.skillsMcp.skillsSection.projectOverrideActive}
                        </span>
                      )}
                    </div>

                    <p className="skill-desc">{skill.description}</p>

                    {/* Permissions list */}
                    <div className="skill-perms-box">
                      <span className="skill-perms-title">
                        {idID.skillsMcp.skillsSection.requestedPermissions}:
                      </span>
                      {skill.requestedPermissions && skill.requestedPermissions.length > 0 ? (
                        <div className="perms-pill-list">
                          {skill.requestedPermissions.map((perm, idx) => (
                            <span
                              key={idx}
                              className={`risk-pill ${perm.riskLevel ? perm.riskLevel.toLowerCase() : 'low'}`}
                              title={`${perm.action} pada ${perm.resource}: ${perm.reason || ''}`}
                            >
                              {perm.action} ({perm.riskLevel || 'LOW'})
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="skill-no-perms-text">
                          {idID.skillsMcp.skillsSection.noPermissions}
                        </span>
                      )}
                    </div>

                    {/* Last outcome */}
                    <div className="skill-outcome-row">
                      <span>{idID.skillsMcp.skillsSection.lastOutcomeLabel}:</span>
                      {skill.lastOutcome === 'success' ? (
                        <span className="outcome-badge success" title={skill.lastUsedAt ?? ''}>
                          <CheckCircle2 size={12} />
                          {idID.skillsMcp.skillsSection.lastOutcomeSuccess}
                        </span>
                      ) : skill.lastOutcome === 'failure' ? (
                        <span
                          className="outcome-badge failure"
                          title={skill.lastError ?? skill.lastUsedAt ?? ''}
                        >
                          <XCircle size={12} />
                          {idID.skillsMcp.skillsSection.lastOutcomeFailure}
                        </span>
                      ) : (
                        <span className="outcome-badge never">
                          {idID.skillsMcp.skillsSection.lastOutcomeNever}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions & switch toggle */}
                  <div className="skill-card-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      iconLeft={<FileCode size={13} />}
                      onClick={() => void handleOpenManifest(skill.name)}
                    >
                      {idID.skillsMcp.skillsSection.manifestBtn}
                    </Button>

                    <label className="switch-toggle" title={isReadOnly ? 'Skill read-only' : 'Ubah status skill'}>
                      <input
                        type="checkbox"
                        checked={skill.isEnabled}
                        disabled={isReadOnly}
                        onChange={() => void handleToggleSkill(skill.name, skill.isEnabled, isReadOnly)}
                      />
                      <span>
                        {skill.isEnabled
                          ? idID.skillsMcp.skillsSection.toggleOn
                          : idID.skillsMcp.skillsSection.toggleOff}
                      </span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MCP TAB CONTENT */}
      {activeTab === 'mcp' && (
        <div className="mcp-tab-content">
          {/* MCP Toolbar */}
          <div className="skills-toolbar">
            <div>
              <h2 className="mcp-toolbar-title">
                {idID.skillsMcp.mcpSection.serversTitle}
              </h2>
              <p className="mcp-toolbar-desc">
                {idID.skillsMcp.mcpSection.adminOnlyNotice}
              </p>
            </div>

            <div className="mcp-toolbar-actions">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<RefreshCw size={14} className={mcpLoading ? 'spin' : ''} />}
                onClick={() => {
                  void fetchMcpServers();
                  void fetchMcpLogs();
                }}
              >
                Segarkan
              </Button>
              <Button
                variant="primary"
                size="sm"
                iconLeft={<Plus size={14} />}
                onClick={() => setIsAddMcpOpen(true)}
              >
                {idID.skillsMcp.mcpSection.addServerBtn}
              </Button>
            </div>
          </div>

          {mcpError && (
            <div className="callout callout-error skills-callout-error">
              {mcpError}
            </div>
          )}

          {/* MCP Servers Grid */}
          <div className="mcp-servers-grid">
            {mcpServers.length === 0 ? (
              <div className="mcp-empty-grid">
                Belum ada server MCP yang dikonfigurasi.
              </div>
            ) : (
              mcpServers.map((server) => (
                <div key={server.id} className="mcp-card">
                  <div className="mcp-card-header">
                    <div>
                      <div className="mcp-server-header-left">
                        <h3 className="mcp-server-title">{server.name}</h3>
                        <span
                          className={`mcp-status-pill ${
                            server.status === 'connected'
                              ? 'connected'
                              : server.status === 'error'
                              ? 'error'
                              : 'disconnected'
                          }`}
                        >
                          <Radio size={10} />
                          {server.status === 'connected'
                            ? idID.skillsMcp.mcpSection.statusConnected
                            : server.status === 'error'
                            ? idID.skillsMcp.mcpSection.statusError
                            : idID.skillsMcp.mcpSection.statusDisconnected}
                        </span>
                      </div>
                      <div className="mcp-server-meta-row">
                        {server.transport === 'stdio' ? <Terminal size={12} /> : <Globe size={12} />}
                        <span>Transport: {server.transport.toUpperCase()}</span>
                        <span>•</span>
                        <span className={`risk-pill ${server.riskLevel.toLowerCase()}`}>
                          {server.riskLevel}
                        </span>
                      </div>
                    </div>

                    <IconButton
                      aria-label="Hapus Server"
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={14} color="#ef4444" />}
                      onClick={() => void handleDeleteMcp(server.id, server.name)}
                    />
                  </div>

                  <div className="mcp-server-cmd">
                    {server.transport === 'stdio'
                      ? `Perintah: ${server.command} ${(server.args ?? []).join(' ')}`
                      : `URL: ${server.url}`}
                  </div>

                  {/* Tools List */}
                  <div className="mcp-tools-list">
                    <div className="mcp-tools-header">
                      {server.tools && server.tools.length > 0
                        ? idID.skillsMcp.mcpSection.toolsCount(server.tools.length)
                        : idID.skillsMcp.mcpSection.noTools}
                    </div>
                    {(server.tools ?? []).map((t, idx) => (
                      <div key={idx} className="mcp-tool-row">
                        <div>
                          <strong>{t.name}</strong>
                          <span className="mcp-tool-desc">
                            {t.description}
                          </span>
                        </div>
                        {t.riskLevel && (
                          <span className={`risk-pill ${t.riskLevel.toLowerCase()} mcp-tool-risk-badge`}>
                            {t.riskLevel}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* MCP Call Logs Table (Audit Trail) */}
          <div className="mcp-audit-section">
            <div className="mcp-audit-header">
              <h3 className="mcp-audit-title">
                {idID.skillsMcp.mcpSection.callLogsTitle}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<RefreshCw size={13} />}
                onClick={() => void fetchMcpLogs()}
              >
                Segarkan Log
              </Button>
            </div>

            <div className="logs-table-container">
              {mcpLogs.length === 0 ? (
                <div className="mcp-audit-empty">
                  {idID.skillsMcp.mcpSection.noLogs}
                </div>
              ) : (
                <table className="mcp-logs-table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Server</th>
                      <th>Alat (Tool)</th>
                      <th>Status</th>
                      <th>Durasi</th>
                      <th>Keterangan / Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mcpLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{new Date(log.createdAt).toLocaleTimeString('id-ID')}</td>
                        <td>
                          <strong>{log.serverId}</strong>
                        </td>
                        <td>{log.toolName}</td>
                        <td>
                          <span
                            className={`risk-pill ${
                              log.status === 'success' ? 'low' : log.status === 'denied' ? 'medium' : 'high'
                            }`}
                          >
                            {log.status.toUpperCase()}
                          </span>
                        </td>
                        <td>{log.durationMs ? `${log.durationMs}ms` : '-'}</td>
                        <td className={log.error ? 'mcp-log-status-error' : 'mcp-log-status-text'}>
                          {log.error || 'Sukses'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PROPOSALS TAB CONTENT */}
      {activeTab === 'proposals' && (
        <div className="skills-tab-content">
          <div className="skills-toolbar">
            <div className="skill-mcp-titles">
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>
                {idID.skillsMcp.proposalsSection.title}
              </h2>
              <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: '0.85rem' }}>
                {idID.skillsMcp.proposalsSection.subtitle}
              </p>
            </div>

            <Button
              variant="secondary"
              size="sm"
              iconLeft={<RefreshCw size={14} className={skillProposalsLoading ? 'spin' : ''} />}
              onClick={() => void fetchSkillProposals()}
            >
              {idID.skillsMcp.proposalsSection.refresh}
            </Button>
          </div>

          <div className="risk-card" style={{ marginTop: 'var(--space-2)' }}>
            <div className="risk-card-header">
              <ShieldCheck size={16} />
              <span>{idID.skillsMcp.riskEducation.title}</span>
            </div>
            <div className="risk-card-body">
              {idID.skillsMcp.proposalsSection.safetyNote}
            </div>
          </div>

          <div className="skills-grid" style={{ marginTop: 'var(--space-4)' }}>
            {skillProposals.length === 0 ? (
              <div className="sidebar-empty-state" style={{ gridColumn: '1 / -1' }}>
                {idID.skillsMcp.proposalsSection.empty}
              </div>
            ) : (
              skillProposals.map((proposal) => {
                const manifest = (proposal.proposedManifest ?? {}) as Record<string, unknown>;
                const isImprovement = Boolean(proposal.targetSkillName);
                const skillTitle = proposal.targetSkillName || String(manifest.name || proposal.skillName || 'Skill Tanpa Nama');
                const toolsList = Array.isArray(manifest.tools) ? (manifest.tools as string[]) : [];

                return (
                  <div key={proposal.id} className="skill-card">
                    <div>
                      <div className="skill-card-header">
                        <div className="skill-title-block">
                          <span className="skill-title">{skillTitle}</span>
                          <span className="skill-scope-badge">
                            {isImprovement
                              ? idID.skillsMcp.proposalsSection.improvementBadge
                              : idID.skillsMcp.proposalsSection.newSkillBadge}
                          </span>
                        </div>
                        <span
                          className={`risk-pill ${
                            proposal.status === 'approved'
                              ? 'low'
                              : proposal.status === 'rejected'
                                ? 'high'
                                : 'medium'
                          }`}
                        >
                          {proposal.status === 'approved'
                            ? idID.skillsMcp.proposalsSection.statusApproved
                            : proposal.status === 'rejected'
                              ? idID.skillsMcp.proposalsSection.statusRejected
                              : idID.skillsMcp.proposalsSection.statusPending}
                        </span>
                      </div>

                      <p className="skill-description">
                        {String(manifest.description || proposal.description || 'Tidak ada deskripsi')}
                      </p>

                      <div className="skill-meta-row" style={{ marginTop: 'var(--space-2)' }}>
                        <span className="skill-meta-item">
                          <strong>Judul:</strong> {proposal.title}
                        </span>
                        {proposal.taskId && (
                          <span className="skill-meta-item">
                            <strong>Sumber Task:</strong> #{proposal.taskId.slice(0, 8)}
                          </span>
                        )}
                        <span className="skill-meta-item">
                          <strong>Tingkat Risiko:</strong> {String(manifest.riskLevel || 'LOW')}
                        </span>
                        {toolsList.length > 0 && (
                          <span className="skill-meta-item">
                            <strong>Alat:</strong> {toolsList.join(', ')}
                          </span>
                        )}
                      </div>

                      {proposal.promptInstructions && (
                        <div style={{ marginTop: 'var(--space-2)' }}>
                          <span className="settings-label" style={{ fontSize: '0.8rem' }}>Instruksi Prompt:</span>
                          <pre
                            className="manifest-code-box"
                            style={{ maxHeight: '120px', overflowY: 'auto', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}
                          >
                            {proposal.promptInstructions}
                          </pre>
                        </div>
                      )}

                      {proposal.diff && (
                        <div className="task-event-diff-box" style={{ marginTop: 'var(--space-2)' }}>
                          <span className="settings-label" style={{ fontSize: '0.8rem' }}>
                            {idID.skillsMcp.proposalsSection.viewDiff}
                          </span>
                          <pre className="tool-step-pre" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                            {proposal.diff.split('\n').map((line, lIdx) => {
                              let lineClass = '';
                              if (line.startsWith('+')) lineClass = 'diff-line-add';
                              else if (line.startsWith('-')) lineClass = 'diff-line-del';
                              else if (line.startsWith('@@')) lineClass = 'diff-line-hunk';
                              return <div key={lIdx} className={lineClass}>{line}</div>;
                            })}
                          </pre>
                        </div>
                      )}

                      {proposal.status === 'rejected' && proposal.rejectionReason && (
                        <div className="task-error-banner" style={{ marginTop: 'var(--space-2)' }}>
                          <strong>{idID.skillsMcp.proposalsSection.rejectionReason}</strong> {proposal.rejectionReason}
                        </div>
                      )}
                    </div>

                    {proposal.status === 'pending' && (
                      <div className="skill-card-footer" style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)' }}>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleApproveProposal(proposal.id)}
                        >
                          {idID.skillsMcp.proposalsSection.approveAction}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setRejectDialog({ open: true, proposalId: proposal.id, reason: '' })}
                        >
                          {idID.skillsMcp.proposalsSection.rejectAction}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* MANIFEST MODAL DIALOG */}
      <Dialog
        isOpen={manifestModal.open}
        onClose={() => setManifestModal((prev) => ({ ...prev, open: false }))}
        title={`${idID.skillsMcp.skillsSection.manifestDialogTitle}: ${manifestModal.skillName}`}
      >
        <div className="mcp-manifest-body">
          <p className="mcp-manifest-desc">
            Manifest resmi JSON terverifikasi oleh ManifestValidator dan Permission Engine.
          </p>
          <pre className="manifest-code-box">
            {JSON.stringify(manifestModal.manifest, null, 2)}
          </pre>
          <div className="mcp-manifest-actions">
            <Button
              variant="secondary"
              onClick={() => setManifestModal((prev) => ({ ...prev, open: false }))}
            >
              {idID.common.close}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ADD MCP SERVER MODAL DIALOG */}
      <Dialog
        isOpen={isAddMcpOpen}
        onClose={() => setIsAddMcpOpen(false)}
        title={idID.skillsMcp.mcpSection.addDialogTitle}
      >
        <form onSubmit={handleAddMcpSubmit} className="mcp-form-body">
          {addMcpData.error && (
            <div className="callout callout-error mcp-form-error">
              {addMcpData.error}
            </div>
          )}

          <div>
            <label className="mcp-form-label">ID Server (unik, tanpa spasi):</label>
            <input
              type="text"
              required
              className="project-select mcp-form-input"
              value={addMcpData.id}
              onChange={(e) => setAddMcpData({ ...addMcpData, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
              placeholder="contoh: github-tools"
            />
          </div>

          <div>
            <label className="mcp-form-label">Nama Tampilan Server:</label>
            <input
              type="text"
              required
              className="project-select mcp-form-input"
              value={addMcpData.name}
              onChange={(e) => setAddMcpData({ ...addMcpData, name: e.target.value })}
              placeholder="contoh: GitHub Tools MCP"
            />
          </div>

          <div>
            <label className="mcp-form-label">{idID.skillsMcp.mcpSection.transportLabel}:</label>
            <select
              className="project-select mcp-form-input"
              value={addMcpData.transport}
              onChange={(e) => setAddMcpData({ ...addMcpData, transport: e.target.value as 'stdio' | 'sse' })}
            >
              <option value="stdio">stdio (Proses Lokal Allowlist)</option>
              <option value="sse">sse (Server Remote HTTP/SSE)</option>
            </select>
          </div>

          {addMcpData.transport === 'stdio' ? (
            <>
              <div>
                <label className="mcp-form-label">{idID.skillsMcp.mcpSection.commandLabel}:</label>
                <select
                  className="project-select mcp-form-input"
                  value={addMcpData.command}
                  onChange={(e) => setAddMcpData({ ...addMcpData, command: e.target.value })}
                >
                  <option value="npx">npx (Node Package Runner)</option>
                  <option value="node">node (Node.js runtime)</option>
                  <option value="docker">docker (Container runner)</option>
                  <option value="uvx">uvx (Python UV package runner)</option>
                  <option value="python3">python3 (Python runtime)</option>
                  <option value="python">python (Python runner)</option>
                </select>
                <span className="mcp-form-hint">
                  {idID.skillsMcp.mcpSection.commandHint}
                </span>
              </div>

              <div>
                <label className="mcp-form-label">{idID.skillsMcp.mcpSection.argsLabel}:</label>
                <input
                  type="text"
                  className="project-select mcp-form-input"
                  value={addMcpData.args}
                  onChange={(e) => setAddMcpData({ ...addMcpData, args: e.target.value })}
                  placeholder="-y @modelcontextprotocol/server-github"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="mcp-form-label">{idID.skillsMcp.mcpSection.urlLabel}:</label>
              <input
                type="url"
                required
                className="project-select mcp-form-input"
                value={addMcpData.url}
                onChange={(e) => setAddMcpData({ ...addMcpData, url: e.target.value })}
                placeholder="https://mcp-server.example.com/sse"
              />
              <span className="mcp-form-hint">
                {idID.skillsMcp.mcpSection.urlHint}
              </span>
            </div>
          )}

          <div>
            <label className="mcp-form-label">{idID.skillsMcp.mcpSection.capabilitiesLabel}:</label>
            <input
              type="text"
              className="project-select mcp-form-input"
              value={addMcpData.capabilities}
              onChange={(e) => setAddMcpData({ ...addMcpData, capabilities: e.target.value })}
              placeholder="docs:read, code:review"
            />
          </div>

          <div>
            <label className="mcp-form-label">{idID.skillsMcp.mcpSection.riskLevelLabel}:</label>
            <select
              className="project-select mcp-form-input"
              value={addMcpData.riskLevel}
              onChange={(e) =>
                setAddMcpData({ ...addMcpData, riskLevel: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' })
              }
            >
              <option value="LOW">LOW (Rendah)</option>
              <option value="MEDIUM">MEDIUM (Sedang)</option>
              <option value="HIGH">HIGH (Tinggi - Butuh Persetujuan)</option>
              <option value="CRITICAL">CRITICAL (Kritis)</option>
            </select>
          </div>

          <div className="mcp-form-actions">
            <Button variant="secondary" onClick={() => setIsAddMcpOpen(false)}>
              {idID.common.cancel}
            </Button>
            <Button variant="primary" type="submit">
              {idID.skillsMcp.mcpSection.confirmAdd}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* REJECT PROPOSAL MODAL DIALOG */}
      <Dialog
        isOpen={rejectDialog.open}
        onClose={() => setRejectDialog({ open: false, proposalId: null, reason: '' })}
        title={idID.skillsMcp.proposalsSection.rejectAction}
      >
        <form onSubmit={handleRejectProposalSubmit} className="mcp-form-body">
          <p className="settings-label">
            {idID.skillsMcp.proposalsSection.reasonPrompt}
          </p>
          <textarea
            className="project-select mcp-form-input"
            rows={3}
            value={rejectDialog.reason}
            onChange={(e) => setRejectDialog({ ...rejectDialog, reason: e.target.value })}
            placeholder="Contoh: Format manifest tidak sesuai standar atau pola belum teruji."
          />
          <div className="mcp-form-actions" style={{ marginTop: 'var(--space-3)' }}>
            <Button
              variant="secondary"
              onClick={() => setRejectDialog({ open: false, proposalId: null, reason: '' })}
            >
              {idID.common.cancel}
            </Button>
            <Button variant="danger" type="submit">
              {idID.skillsMcp.proposalsSection.rejectAction}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};
