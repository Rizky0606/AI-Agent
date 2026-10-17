import React, { useState, useEffect } from 'react';
import { RefreshCw, Plus, Pause, Play, Trash2, Calendar, Sparkles } from 'lucide-react';
import { type TaskRecord } from '@personal-ai-os/shared';
import { useAgentStore } from '../context.ts';
import { TaskCard } from './TaskCard.tsx';
import { ApprovalCard } from './ApprovalCard.tsx';
import { ArtifactCard } from './ArtifactCard.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { Button } from '../components/Button.tsx';
import { useToast } from '../components/Toast.tsx';
import { idID } from '../locales/id-ID.ts';

export type ActivitySubTab = 'tasks' | 'schedules' | 'approvals' | 'artifacts';

interface ActivityPanelProps {
  onNewApprovalDetected?: (action: string) => void;
}

export const ActivityPanel: React.FC<ActivityPanelProps> = ({
  onNewApprovalDetected,
}) => {
  const {
    serverTasks,
    refreshServerTasks,
    selectedTaskId,
    selectServerTask,
    pauseServerTask,
    resumeServerTask,
    cancelServerTask,
    taskEvents,
    approvals,
    refreshApprovals,
    decideApproval,
    artifacts,
    refreshArtifacts,
    openArtifact,
    closeArtifactPreview,
    artifactPreview,
    schedules,
    fetchSchedules,
    createSchedule,
    pauseSchedule,
    resumeSchedule,
    cancelSchedule,
    createSkillProposal,
  } = useAgentStore();

  const { success, error: toastError } = useToast();

  const [activeTab, setActiveTab] = useState<ActivitySubTab>('approvals');
  const [previousPendingCount, setPreviousPendingCount] = useState(0);

  // Create Schedule Modal State
  const [isCreateScheduleOpen, setIsCreateScheduleOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState<{
    name: string;
    scheduleType: 'one_off' | 'recurring';
    preset: 'daily' | 'weekly' | 'custom';
    cron: string;
    runAt: string;
    kind: 'generic' | 'research' | 'coding';
    prompt: string;
    submitting: boolean;
    error: string | null;
  }>({
    name: '',
    scheduleType: 'recurring',
    preset: 'daily',
    cron: '0 8 * * *',
    runAt: new Date(Date.now() + 16 * 60 * 1000).toISOString().slice(0, 16),
    kind: 'generic',
    prompt: '',
    submitting: false,
    error: null,
  });

  // Propose Skill Modal State
  const [proposeModal, setProposeModal] = useState<{
    open: boolean;
    task: TaskRecord | null;
    name: string;
    description: string;
    instructions: string;
    submitting: boolean;
    error: string | null;
  }>({
    open: false,
    task: null,
    name: '',
    description: '',
    instructions: '',
    submitting: false,
    error: null,
  });

  const pendingApprovals = approvals.filter((item) => item.status === 'pending');
  const pendingCount = pendingApprovals.length;

  // Detect new pending approvals and trigger callback
  useEffect(() => {
    if (pendingCount > previousPendingCount && onNewApprovalDetected) {
      const latest = pendingApprovals[pendingApprovals.length - 1];
      if (latest) {
        onNewApprovalDetected(latest.action);
      }
    }
    setPreviousPendingCount(pendingCount);
  }, [pendingCount, previousPendingCount, pendingApprovals, onNewApprovalDetected]);

  // Load schedules when switching to schedules tab
  useEffect(() => {
    if (activeTab === 'schedules') {
      void fetchSchedules();
    }
  }, [activeTab, fetchSchedules]);

  const handleCreateScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleForm.prompt.trim()) {
      setScheduleForm((prev) => ({ ...prev, error: 'Instruksi tugas wajib diisi.' }));
      return;
    }

    setScheduleForm((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      let cronExpr: string | undefined = undefined;
      let runAtIso: string | undefined = undefined;

      if (scheduleForm.scheduleType === 'recurring') {
        if (scheduleForm.preset === 'daily') {
          cronExpr = '0 8 * * *';
        } else if (scheduleForm.preset === 'weekly') {
          cronExpr = '0 8 * * 1';
        } else {
          cronExpr = scheduleForm.cron.trim();
        }
      } else {
        const date = new Date(scheduleForm.runAt);
        if (isNaN(date.getTime())) {
          throw new Error('Waktu pelaksanaan tidak valid.');
        }
        runAtIso = date.toISOString();
      }

      await createSchedule({
        name: scheduleForm.name.trim() || `Jadwal ${scheduleForm.kind}`,
        type: scheduleForm.scheduleType,
        cronExpression: cronExpr,
        runAt: runAtIso,
        timezone: 'Asia/Jakarta',
        taskPayload: {
          kind: scheduleForm.kind,
          input: {
            prompt: scheduleForm.prompt.trim(),
          },
        },
      });

      success('Jadwal tugas berhasil dibuat.');
      setIsCreateScheduleOpen(false);
      setScheduleForm((prev) => ({
        ...prev,
        name: '',
        prompt: '',
        submitting: false,
        error: null,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat jadwal.';
      setScheduleForm((prev) => ({ ...prev, submitting: false, error: msg }));
      toastError(msg);
    }
  };

  const handleOpenProposeSkill = (task: TaskRecord) => {
    const defaultName = `skill-${task.kind}-${task.id.slice(0, 6)}`;
    const taskPrompt = typeof task.payload?.prompt === 'string'
      ? task.payload.prompt
      : typeof task.payload?.input === 'string'
        ? task.payload.input
        : `Instruksi yang diekstraksi dari task ${task.id}`;

    setProposeModal({
      open: true,
      task,
      name: defaultName,
      description: `Skill otomatis dari pola tugas ${task.kind} #${task.id.slice(0, 6)}`,
      instructions: taskPrompt,
      submitting: false,
      error: null,
    });
  };

  const handleSubmitProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposeModal.name.trim() || !proposeModal.instructions.trim()) {
      setProposeModal((prev) => ({ ...prev, error: 'Nama dan instruksi skill wajib diisi.' }));
      return;
    }

    setProposeModal((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      const cleanName = proposeModal.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const desc = proposeModal.description.trim() || 'Skill yang diusulkan oleh sistem agen';
      await createSkillProposal({
        skillName: cleanName,
        title: proposeModal.name.trim(),
        description: desc,
        proposedManifest: {
          name: cleanName,
          version: '1.0.0',
          description: desc,
          tools: ['docs:read'],
          riskLevel: 'LOW',
          requiredCapabilities: [],
        },
        promptInstructions: proposeModal.instructions.trim(),
        changeType: 'new_skill',
        taskId: proposeModal.task?.id,
      });

      success('Usulan skill berhasil diajukan! Skill ini tetap NONAKTIF hingga disetujui di Manajer Skill.');
      setProposeModal({
        open: false,
        task: null,
        name: '',
        description: '',
        instructions: '',
        submitting: false,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengajukan usulan skill.';
      setProposeModal((prev) => ({ ...prev, submitting: false, error: msg }));
      toastError(msg);
    }
  };

  return (
    <div className="activity-container">
      {/* Sub-tab navigation */}
      <nav className="activity-subtabs-nav" role="tablist" aria-label="Kategori Aktivitas">
        <button
          type="button"
          className={`activity-subtab-btn ${activeTab === 'approvals' ? 'active' : ''}`}
          onClick={() => setActiveTab('approvals')}
          role="tab"
          aria-selected={activeTab === 'approvals'}
        >
          <span>{idID.activity.tabs.approvals}</span>
          {pendingCount > 0 && (
            <span className="activity-badge">{pendingCount}</span>
          )}
        </button>

        <button
          type="button"
          className={`activity-subtab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
          role="tab"
          aria-selected={activeTab === 'tasks'}
        >
          <span>{idID.activity.tabs.tasks}</span>
          <span className="conversation-item-meta">({serverTasks.length})</span>
        </button>

        <button
          type="button"
          className={`activity-subtab-btn ${activeTab === 'schedules' ? 'active' : ''}`}
          onClick={() => setActiveTab('schedules')}
          role="tab"
          aria-selected={activeTab === 'schedules'}
        >
          <span>{idID.activity.tabs.schedules}</span>
          <span className="conversation-item-meta">({schedules.length})</span>
        </button>

        <button
          type="button"
          className={`activity-subtab-btn ${activeTab === 'artifacts' ? 'active' : ''}`}
          onClick={() => setActiveTab('artifacts')}
          role="tab"
          aria-selected={activeTab === 'artifacts'}
        >
          <span>{idID.activity.tabs.artifacts}</span>
          <span className="conversation-item-meta">({artifacts.length})</span>
        </button>
      </nav>

      {/* Tab 1: Approvals */}
      {activeTab === 'approvals' && (
        <div className="activity-scroll-list" role="tabpanel">
          <div className="card-header-row">
            <span className="settings-hint">
              {pendingCount > 0
                ? `${pendingCount} persetujuan menunggu keputusan Anda.`
                : 'Semua persetujuan telah diselesaikan.'}
            </span>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => void refreshApprovals()}
              title={idID.activity.tasks.refresh}
            >
              <RefreshCw size={12} />
              <span>{idID.activity.tasks.refresh}</span>
            </button>
          </div>

          {approvals.length === 0 ? (
            <div className="sidebar-empty-state">
              {idID.activity.approvals.empty}
            </div>
          ) : (
            approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onDecide={async (id, decision, reason) => {
                  await decideApproval(id, decision, reason);
                }}
              />
            ))
          )}
        </div>
      )}

      {/* Tab 2: Tasks */}
      {activeTab === 'tasks' && (
        <div className="activity-scroll-list" role="tabpanel">
          <div className="card-header-row">
            <span className="settings-hint">
              {serverTasks.length} tugas terdaftar.
            </span>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => void refreshServerTasks()}
              title={idID.activity.tasks.refresh}
            >
              <RefreshCw size={12} />
              <span>{idID.activity.tasks.refresh}</span>
            </button>
          </div>

          {serverTasks.length === 0 ? (
            <div className="sidebar-empty-state">
              {idID.activity.tasks.empty}
            </div>
          ) : (
            serverTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isSelected={task.id === selectedTaskId}
                events={task.id === selectedTaskId ? taskEvents : undefined}
                onSelect={(id) => void selectServerTask(id)}
                onPause={pauseServerTask}
                onResume={resumeServerTask}
                onCancel={cancelServerTask}
                onProposeSkill={handleOpenProposeSkill}
              />
            ))
          )}
        </div>
      )}

      {/* Tab 3: Schedules */}
      {activeTab === 'schedules' && (
        <div className="activity-scroll-list" role="tabpanel">
          <div className="card-header-row">
            <span className="settings-hint">
              {idID.activity.schedules.quotaWarning}
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                type="button"
                className="ui-btn ui-btn-primary ui-btn-sm"
                onClick={() => setIsCreateScheduleOpen(true)}
              >
                <Plus size={12} />
                <span>{idID.activity.schedules.newSchedule}</span>
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                onClick={() => void fetchSchedules()}
                title={idID.activity.schedules.refresh}
              >
                <RefreshCw size={12} />
                <span>{idID.activity.schedules.refresh}</span>
              </button>
            </div>
          </div>

          {schedules.length === 0 ? (
            <div className="sidebar-empty-state">
              {idID.activity.schedules.empty}
            </div>
          ) : (
            schedules.map((sched) => (
              <div key={sched.id} className="activity-card">
                <div className="card-header-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Calendar size={14} color="var(--color-primary, #3b82f6)" />
                    <strong className="card-title-text">{sched.name || sched.id}</strong>
                  </div>
                  <span className={`status-pill ${sched.status}`}>
                    {sched.status === 'active'
                      ? idID.activity.schedules.activeStatus
                      : sched.status === 'paused'
                        ? idID.activity.schedules.pausedStatus
                        : sched.status}
                  </span>
                </div>

                <div className="card-meta-row">
                  <span>ID: <code>{sched.id.slice(0, 8)}</code></span>
                  <span>Tipe: {sched.type === 'recurring' ? 'Berulang' : 'Sekali'}</span>
                  {sched.cronExpression && <span>Cron: <code>{sched.cronExpression}</code></span>}
                  {sched.runAt && <span>Waktu: {new Date(sched.runAt).toLocaleString('id-ID')}</span>}
                  <span>Zona: {sched.timezone}</span>
                </div>

                <div className="card-meta-row" style={{ marginTop: 'var(--space-1)' }}>
                  <span>Permintaan: <strong>{sched.taskPayload?.kind || 'generic'}</strong></span>
                </div>
                <div className="task-event-text" style={{ marginTop: 'var(--space-1)' }}>
                  {typeof sched.taskPayload?.input?.prompt === 'string'
                    ? (sched.taskPayload.input.prompt as string)
                    : JSON.stringify(sched.taskPayload?.input ?? {})}
                </div>

                {/* Last brief section */}
                {sched.lastBrief ? (
                  <div className="task-checkpoint-block" style={{ marginTop: 'var(--space-2)' }}>
                    <div className="task-checkpoint-header">
                      <span className="task-checkpoint-label">{idID.activity.schedules.lastBriefLabel}</span>
                    </div>
                    <div className="task-event-text" style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--space-1)' }}>
                      {sched.lastBrief}
                    </div>
                  </div>
                ) : (
                  <div className="settings-hint" style={{ marginTop: 'var(--space-1)' }}>
                    {idID.activity.schedules.noBrief}
                  </div>
                )}

                {/* Schedule controls */}
                <div className="card-header-row" style={{ marginTop: 'var(--space-3)' }}>
                  <div className="chat-error-actions">
                    {sched.status === 'active' && (
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary ui-btn-sm"
                        onClick={async () => {
                          try {
                            await pauseSchedule(sched.id);
                            success('Jadwal berhasil dijeda.');
                          } catch (err) {
                            toastError(err instanceof Error ? err.message : 'Gagal menjeda jadwal.');
                          }
                        }}
                      >
                        <Pause size={12} />
                        <span>{idID.activity.schedules.pause}</span>
                      </button>
                    )}
                    {sched.status === 'paused' && (
                      <button
                        type="button"
                        className="ui-btn ui-btn-primary ui-btn-sm"
                        onClick={async () => {
                          try {
                            await resumeSchedule(sched.id);
                            success('Jadwal berhasil dilanjutkan.');
                          } catch (err) {
                            toastError(err instanceof Error ? err.message : 'Gagal melanjutkan jadwal.');
                          }
                        }}
                      >
                        <Play size={12} />
                        <span>{idID.activity.schedules.resume}</span>
                      </button>
                    )}
                    {sched.status !== 'cancelled' && (
                      <button
                        type="button"
                        className="ui-btn ui-btn-danger ui-btn-sm"
                        onClick={async () => {
                          if (window.confirm('Batalkan jadwal tugas ini?')) {
                            try {
                              await cancelSchedule(sched.id);
                              success('Jadwal berhasil dibatalkan.');
                            } catch (err) {
                              toastError(err instanceof Error ? err.message : 'Gagal membatalkan jadwal.');
                            }
                          }
                        }}
                      >
                        <Trash2 size={12} />
                        <span>{idID.activity.schedules.cancel}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 4: Artifacts */}
      {activeTab === 'artifacts' && (
        <div className="activity-scroll-list" role="tabpanel">
          <div className="card-header-row">
            <span className="settings-hint">
              {artifacts.length} berkas artefak tersimpan.
            </span>
            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-sm"
              onClick={() => void refreshArtifacts()}
              title={idID.activity.tasks.refresh}
            >
              <RefreshCw size={12} />
              <span>{idID.activity.tasks.refresh}</span>
            </button>
          </div>

          {/* Artifact Preview Card */}
          {artifactPreview ? (
            <div className="activity-card">
              <div className="card-header-row">
                <strong className="card-title-text">{idID.activity.artifacts.preview}</strong>
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost ui-btn-sm"
                  onClick={closeArtifactPreview}
                >
                  {idID.activity.artifacts.closePreview}
                </button>
              </div>

              {artifactPreview.truncated && (
                <span className="settings-hint text-amber">
                  {idID.activity.artifacts.truncatedNotice}
                </span>
              )}

              <pre className="task-events-box">
                {artifactPreview.content}
              </pre>
            </div>
          ) : null}

          {artifacts.length === 0 ? (
            <div className="sidebar-empty-state">
              {idID.activity.artifacts.empty}
            </div>
          ) : (
            artifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                onPreview={(id) => void openArtifact(id)}
              />
            ))
          )}
        </div>
      )}

      {/* Modal: Buat Jadwal Baru */}
      <Dialog
        isOpen={isCreateScheduleOpen}
        onClose={() => setIsCreateScheduleOpen(false)}
        title={idID.activity.schedules.newSchedule}
        maxWidth="520px"
      >
        <form onSubmit={handleCreateScheduleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {scheduleForm.error && (
            <div className="task-error-banner">{scheduleForm.error}</div>
          )}

          <div className="settings-form-group">
            <label className="settings-label">{idID.activity.schedules.nameLabel}</label>
            <input
              type="text"
              className="ui-input"
              placeholder={idID.activity.schedules.namePlaceholder}
              value={scheduleForm.name}
              onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })}
            />
          </div>

          <div className="settings-form-group">
            <label className="settings-label">{idID.activity.schedules.typeLabel}</label>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="scheduleType"
                  value="recurring"
                  checked={scheduleForm.scheduleType === 'recurring'}
                  onChange={() => setScheduleForm({ ...scheduleForm, scheduleType: 'recurring' })}
                />
                <span>{idID.activity.schedules.recurring}</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="scheduleType"
                  value="one_off"
                  checked={scheduleForm.scheduleType === 'one_off'}
                  onChange={() => setScheduleForm({ ...scheduleForm, scheduleType: 'one_off' })}
                />
                <span>{idID.activity.schedules.oneOff}</span>
              </label>
            </div>
          </div>

          {scheduleForm.scheduleType === 'recurring' ? (
            <div className="settings-form-group">
              <label className="settings-label">Pola Frekuensi</label>
              <select
                className="ui-input"
                value={scheduleForm.preset}
                onChange={(e) => setScheduleForm({ ...scheduleForm, preset: e.target.value as 'daily' | 'weekly' | 'custom' })}
              >
                <option value="daily">{idID.activity.schedules.presetDaily} (08:00 WIB)</option>
                <option value="weekly">{idID.activity.schedules.presetWeekly} (Senin 08:00 WIB)</option>
                <option value="custom">{idID.activity.schedules.presetCustom}</option>
              </select>

              {scheduleForm.preset === 'custom' && (
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <label className="settings-label">{idID.activity.schedules.cronLabel}</label>
                  <input
                    type="text"
                    className="ui-input"
                    placeholder="0 9 * * *"
                    value={scheduleForm.cron}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, cron: e.target.value })}
                  />
                  <span className="settings-hint">Format cron 5 kolom standard. Min. interval 15 menit.</span>
                </div>
              )}
            </div>
          ) : (
            <div className="settings-form-group">
              <label className="settings-label">{idID.activity.schedules.timeLabel}</label>
              <input
                type="datetime-local"
                className="ui-input"
                value={scheduleForm.runAt}
                onChange={(e) => setScheduleForm({ ...scheduleForm, runAt: e.target.value })}
              />
              <span className="settings-hint">Waktu eksekusi masa depan (min. 15 menit dari sekarang).</span>
            </div>
          )}

          <div className="settings-form-group">
            <label className="settings-label">{idID.activity.schedules.timezoneLabel}</label>
            <input type="text" className="ui-input" value="Asia/Jakarta" disabled />
          </div>

          <div className="settings-form-group">
            <label className="settings-label">{idID.activity.schedules.kindLabel}</label>
            <select
              className="ui-input"
              value={scheduleForm.kind}
              onChange={(e) => setScheduleForm({ ...scheduleForm, kind: e.target.value as 'generic' | 'research' | 'coding' })}
            >
              <option value="generic">Umum (Generic)</option>
              <option value="research">Riset (Research)</option>
              <option value="coding">Koding (Coding)</option>
            </select>
          </div>

          <div className="settings-form-group">
            <label className="settings-label">{idID.activity.schedules.promptLabel}</label>
            <textarea
              className="ui-input"
              rows={3}
              placeholder={idID.activity.schedules.promptPlaceholder}
              value={scheduleForm.prompt}
              onChange={(e) => setScheduleForm({ ...scheduleForm, prompt: e.target.value })}
            />
          </div>

          <div className="ui-dialog-actions" style={{ marginTop: 'var(--space-2)' }}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsCreateScheduleOpen(false)}
            >
              {idID.activity.schedules.cancelDialog}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={scheduleForm.submitting}
            >
              {scheduleForm.submitting ? 'Menyimpan...' : idID.activity.schedules.submit}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal: Usulkan Skill dari Task */}
      <Dialog
        isOpen={proposeModal.open}
        onClose={() => setProposeModal({ ...proposeModal, open: false })}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Sparkles size={16} color="var(--color-primary, #3b82f6)" />
            <span>{idID.activity.tasks.proposeSkill}</span>
          </div>
        }
        maxWidth="540px"
      >
        <form onSubmit={handleSubmitProposal} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {proposeModal.error && (
            <div className="task-error-banner">{proposeModal.error}</div>
          )}

          <div className="risk-card" style={{ padding: 'var(--space-3)' }}>
            <span className="risk-card-body" style={{ fontSize: '0.85rem' }}>
              {idID.skillsMcp.proposalsSection.safetyNote}
            </span>
          </div>

          <div className="settings-form-group">
            <label className="settings-label">Nama Keterampilan (Identifier)</label>
            <input
              type="text"
              className="ui-input"
              placeholder="contoh: analitik-proyek"
              value={proposeModal.name}
              onChange={(e) => setProposeModal({ ...proposeModal, name: e.target.value })}
            />
          </div>

          <div className="settings-form-group">
            <label className="settings-label">Deskripsi Singkat</label>
            <input
              type="text"
              className="ui-input"
              value={proposeModal.description}
              onChange={(e) => setProposeModal({ ...proposeModal, description: e.target.value })}
            />
          </div>

          <div className="settings-form-group">
            <label className="settings-label">Instruksi Prompt Pola Skill</label>
            <textarea
              className="ui-input"
              rows={4}
              value={proposeModal.instructions}
              onChange={(e) => setProposeModal({ ...proposeModal, instructions: e.target.value })}
            />
          </div>

          <div className="ui-dialog-actions" style={{ marginTop: 'var(--space-2)' }}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setProposeModal({ ...proposeModal, open: false })}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={proposeModal.submitting}
            >
              {proposeModal.submitting ? 'Mengajukan...' : 'Ajukan Usulan Skill'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};
