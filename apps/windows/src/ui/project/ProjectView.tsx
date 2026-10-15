import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Folder, File, RefreshCw, Save, AlertCircle } from 'lucide-react';
import { useAgentStore } from '../context.ts';
import { Dialog } from '../components/Dialog.tsx';
import { Button } from '../components/Button.tsx';
import { idID } from '../locales/id-ID.ts';

interface FileTreeEntry {
  path: string;
  name: string;
  kind: 'directory' | 'file';
  size: number;
}

export const ProjectView: React.FC = () => {
  const { allowedRoots, capabilities } = useAgentStore();
  const [selectedRoot, setSelectedRoot] = useState(allowedRoots[0] ?? '');
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [text, setText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);

  useEffect(() => {
    if (!allowedRoots.includes(selectedRoot)) {
      setSelectedRoot(allowedRoots[0] ?? '');
    }
  }, [allowedRoots, selectedRoot]);

  const refreshTree = async () => {
    if (!selectedRoot) return;
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<FileTreeEntry[]>('list_allowed_tree', {
        path: selectedRoot,
        maxDepth: 6,
      });
      setEntries(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedRoot) {
      void refreshTree();
    }
  }, [selectedRoot]);

  const openFile = async (path: string) => {
    setSelectedPath(path);
    setError(null);
    setSaveSuccessNotice(false);
    try {
      const content = await invoke<string>('read_allowed_text', {
        path,
        maxBytes: 512_000,
      });
      setText(content);
      setOriginalText(content);
    } catch (err) {
      setError(String(err));
      setText('');
      setOriginalText('');
    }
  };

  const handleSaveConfirmed = async () => {
    if (!selectedPath || text === originalText || !capabilities.filesystem) {
      return;
    }
    setError(null);
    try {
      await invoke('write_allowed_file', {
        path: selectedPath,
        content: text,
      });
      setOriginalText(text);
      setConfirmDialogOpen(false);
      setSaveSuccessNotice(true);
      await refreshTree();
    } catch (err) {
      setError(String(err));
    }
  };

  const hasDiff = selectedPath && text !== originalText;

  return (
    <div className="project-container">
      {/* Header */}
      <div className="project-header">
        <div className="project-header-left">
          <h1 className="project-title">{idID.project.title}</h1>
          <p className="project-subtitle">{idID.project.subtitle}</p>
        </div>

        <div className="project-header-actions">
          <select
            className="project-root-select"
            value={selectedRoot}
            onChange={(e) => setSelectedRoot(e.target.value)}
            disabled={loading}
            aria-label={idID.project.rootLabel}
          >
            {allowedRoots.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-sm"
            onClick={() => void refreshTree()}
            disabled={!selectedRoot || loading}
            title={idID.project.refresh}
          >
            <RefreshCw size={14} className={loading ? 'ui-spinner' : ''} />
            <span>{idID.project.refresh}</span>
          </button>
        </div>
      </div>

      {/* Error / Alert notice */}
      {error && (
        <div className="chat-error-banner" role="alert">
          <div className="conversation-item-inner">
            <AlertCircle size={16} className="text-rose flex-shrink-0" />
            <span className="chat-error-text">{error}</span>
          </div>
          <button
            type="button"
            className="ui-btn ui-btn-ghost ui-btn-sm"
            onClick={() => setError(null)}
          >
            {idID.common.close}
          </button>
        </div>
      )}

      {/* Save Success notice */}
      {saveSuccessNotice && (
        <div className="chat-error-banner" role="status">
          <span className="card-title-text text-emerald">{idID.project.saveSuccess}</span>
          <button
            type="button"
            className="ui-btn ui-btn-ghost ui-btn-sm"
            onClick={() => setSaveSuccessNotice(false)}
          >
            {idID.common.close}
          </button>
        </div>
      )}

      {/* Main Grid: File Tree on left, Editor and Diff on right */}
      <div className="project-grid">
        {/* Left Column: File Tree */}
        <div className="project-file-sidebar">
          <div className="conversation-group-title">
            {idID.project.treeTitle}
          </div>

          <div className="project-tree-list">
            {entries.length === 0 ? (
              <div className="sidebar-empty-state">
                {idID.project.emptyTree}
              </div>
            ) : (
              entries.map((entry) => {
                const isSelected = entry.path === selectedPath;
                return (
                  <button
                    key={entry.path}
                    className={`project-tree-item ${isSelected ? 'active' : ''}`}
                    disabled={entry.kind === 'directory'}
                    onClick={() => void openFile(entry.path)}
                  >
                    {entry.kind === 'directory' ? (
                      <Folder size={14} className="text-amber flex-shrink-0" />
                    ) : (
                      <File size={14} className="text-cyan flex-shrink-0" />
                    )}
                    <span className="conversation-item-title">{entry.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Code Editor & Diff */}
        <div className="project-editor-container">
          {/* File Toolbar */}
          <div className="project-editor-toolbar">
            <div className="conversation-item-inner">
              <span className="settings-field-label">Berkas:</span>
              <code className="project-editor-path">
                {selectedPath || idID.project.editorPlaceholder}
              </code>
            </div>

            <button
              type="button"
              className="ui-btn ui-btn-primary ui-btn-sm"
              onClick={() => setConfirmDialogOpen(true)}
              disabled={!hasDiff || !capabilities.filesystem}
              title={idID.project.saveButton}
            >
              <Save size={14} />
              <span>{idID.project.saveButton}</span>
            </button>
          </div>

          {/* Editor Area */}
          <textarea
            className="project-editor-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!selectedPath}
            placeholder={idID.project.editorPlaceholder}
          />

          {/* Diff Preview Accordion */}
          {hasDiff && (
            <details className="project-diff-section">
              <summary className="project-diff-summary">
                {idID.project.diffPreview}
              </summary>
              <div className="project-diff-grid">
                <div className="project-diff-col">
                  <span className="project-diff-label-old">LAMA</span>
                  <pre className="project-diff-pre">
                    {originalText}
                  </pre>
                </div>
                <div className="project-diff-col">
                  <span className="project-diff-label-new">BARU</span>
                  <pre className="project-diff-pre">
                    {text}
                  </pre>
                </div>
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Confirmation Dialog for Save (replaces window.confirm) */}
      <Dialog
        isOpen={confirmDialogOpen}
        onClose={() => setConfirmDialogOpen(false)}
        title={idID.project.confirmSaveTitle}
      >
        <div className="settings-form-group">
          <p className="settings-card-subtitle">
            {idID.project.confirmSaveBody(selectedPath)}
          </p>

          <div className="approval-action-btns">
            <Button variant="secondary" size="sm" onClick={() => setConfirmDialogOpen(false)}>
              {idID.common.cancel}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleSaveConfirmed()}>
              {idID.common.save}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
