import React, { useState } from 'react';
import {
  Trophy,
  Copy,
  Check,
  MessageSquareShare,
  EyeOff,
  AlertCircle,
  Loader2,
  Clock,
  Coins,
  Cpu,
} from 'lucide-react';
import type { CompareColumnResult } from '@personal-ai-os/shared';
import { idID } from '../locales/id-ID.ts';

interface CompareColumnProps {
  result: CompareColumnResult;
  blindMode: boolean;
  isRevealed: boolean;
  isWinner: boolean;
  onSelectWinner: () => void;
  onPromote: () => void;
  isRunRunning: boolean;
}

export const CompareColumn: React.FC<CompareColumnProps> = ({
  result,
  blindMode,
  isRevealed,
  isWinner,
  onSelectWinner,
  onPromote,
  isRunRunning,
}) => {
  const [copied, setCopied] = useState(false);

  const isModelHidden = blindMode && !isRevealed;
  const displayName = isModelHidden ? result.columnLabel : (result.modelId || result.columnLabel);

  const handleCopy = async () => {
    if (!result.content) return;
    try {
      await navigator.clipboard.writeText(result.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const hasMetrics =
    result.latencyMs !== undefined ||
    result.promptTokens !== undefined ||
    result.completionTokens !== undefined ||
    result.estimatedCostUsd !== undefined;

  return (
    <div className={`compare-column-card ${isWinner ? 'is-winner' : ''}`}>
      {/* Column Header */}
      <div className="compare-column-header">
        <div className="compare-column-title-group">
          {isModelHidden && <EyeOff size={15} color="var(--text-muted)" />}
          <span className="compare-column-model-name" title={displayName}>
            {displayName}
          </span>
          {!isModelHidden && result.provider && (
            <span className="compare-model-provider-badge">{result.provider}</span>
          )}
        </div>

        {isWinner && (
          <span className="compare-column-winner-tag">
            <Trophy size={12} />
            {idID.compare.winnerBadge}
          </span>
        )}
      </div>

      {/* Metrics Row (only displayed if gateway provided honest data) */}
      {hasMetrics && (
        <div className="compare-column-metrics">
          {result.latencyMs !== undefined && (
            <div className="compare-metric-item" title={idID.compare.latencyLabel}>
              <Clock size={12} />
              <span className="compare-metric-value">{result.latencyMs} ms</span>
            </div>
          )}
          {(result.promptTokens !== undefined || result.completionTokens !== undefined) && (
            <div className="compare-metric-item" title={idID.compare.tokensLabel}>
              <Cpu size={12} />
              <span className="compare-metric-value">
                {result.promptTokens ?? 0} in / {result.completionTokens ?? 0} out
                {result.totalTokens !== undefined ? ` (${result.totalTokens} tot)` : ''}
              </span>
            </div>
          )}
          {result.estimatedCostUsd != null && (
            <div className="compare-metric-item" title={idID.compare.costLabel}>
              <Coins size={12} />
              <span className="compare-metric-value">
                ${result.estimatedCostUsd < 0.0001
                  ? result.estimatedCostUsd.toExponential(2)
                  : result.estimatedCostUsd.toFixed(5)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Content Body */}
      <div className="compare-column-body">
        {result.status === 'failed' ? (
          <div className="compare-column-failed-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontWeight: 600 }}>
              <AlertCircle size={15} />
              <span>{idID.compare.errorTitle}</span>
            </div>
            <div>{result.error ?? 'Model gagal merespons.'}</div>
            <div style={{ marginTop: 8, fontSize: '0.75rem', opacity: 0.85 }}>
              {idID.compare.noFallbackNotice}
            </div>
          </div>
        ) : result.content ? (
          <div>{result.content}</div>
        ) : isRunRunning || result.status === 'running' ? (
          <div className="compare-column-loading-box">
            <Loader2 size={16} className="ui-spin" />
            <span>{idID.compare.status.running}</span>
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>Belum ada konten jawaban.</div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="compare-column-footer">
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-xs"
          onClick={handleCopy}
          disabled={!result.content}
          title={idID.compare.copyAnswer}
        >
          {copied ? <Check size={13} color="var(--color-success, #10b981)" /> : <Copy size={13} />}
          <span>{copied ? idID.compare.copied : idID.compare.copyAnswer}</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className={`ui-btn ui-btn-xs ${isWinner ? 'ui-btn-secondary' : 'ui-btn-primary'}`}
            onClick={onSelectWinner}
            disabled={!result.content && result.status !== 'completed'}
            title={idID.compare.pickWinner}
          >
            <Trophy size={13} />
            <span>{isWinner ? idID.compare.winnerBadge : idID.compare.pickWinner}</span>
          </button>

          <button
            type="button"
            className="ui-btn ui-btn-ghost ui-btn-xs"
            onClick={onPromote}
            disabled={!result.content}
            title={idID.compare.promoteToChat}
          >
            <MessageSquareShare size={13} />
            <span>{idID.compare.promoteToChat}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
