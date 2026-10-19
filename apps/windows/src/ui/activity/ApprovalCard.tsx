import React, { useState } from 'react';
import { AlertTriangle, ShieldAlert, Check, X } from 'lucide-react';
import type { ApprovalRecord } from '../../api/client.ts';
import { Dialog } from '../components/Dialog.tsx';
import { Button } from '../components/Button.tsx';
import { idID } from '../locales/id-ID.ts';

interface ApprovalCardProps {
  approval: ApprovalRecord;
  onDecide: (approvalId: string, decision: 'approve' | 'deny', reason?: string) => Promise<void>;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ approval, onDecide }) => {
  const [reason, setReason] = useState('');
  const [pendingDecision, setPendingDecision] = useState<'approve' | 'deny' | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const isHighRisk = approval.riskLevel === 'HIGH' || approval.riskLevel === 'CRITICAL';

  const handleActionClick = (decision: 'approve' | 'deny') => {
    if (isHighRisk) {
      setPendingDecision(decision);
      setDialogOpen(true);
    } else {
      void executeDecision(decision);
    }
  };

  const executeDecision = async (decision: 'approve' | 'deny') => {
    setLoading(true);
    try {
      await onDecide(approval.id, decision, reason.trim() || undefined);
      setDialogOpen(false);
      setPendingDecision(null);
    } finally {
      setLoading(false);
    }
  };

  const riskClass = (level: string) => {
    switch (level) {
      case 'CRITICAL':
        return 'critical';
      case 'HIGH':
        return 'high';
      case 'MEDIUM':
        return 'medium';
      case 'LOW':
      default:
        return 'low';
    }
  };

  return (
    <>
      <div className={`activity-card ${isHighRisk ? 'high-risk' : ''} approval-card--${riskClass(approval.riskLevel)}`}>
        {/* Header: Action name, Waiting Duration, and Risk Badge */}
        <div className="card-header-row">
          <div className="conversation-item-inner">
            {isHighRisk ? (
              <ShieldAlert size={16} className="text-rose flex-shrink-0" />
            ) : (
              <AlertTriangle size={16} className="text-amber flex-shrink-0" />
            )}
            <strong className="card-title-text">{approval.action}</strong>
          </div>
          <div className="card-header-right-badges">
            {approval.createdAt && (
              <span className="approval-waiting-badge" title={`Dibuat pada ${new Date(approval.createdAt).toLocaleTimeString()}`}>
                Menunggu {Math.max(1, Math.round((Date.now() - new Date(approval.createdAt).getTime()) / 60000))}m
              </span>
            )}
            <span className={`risk-pill ${riskClass(approval.riskLevel)}`}>
              {approval.riskLevel}
            </span>
          </div>
        </div>

        {/* Consequences and Risk Details */}
        <div className="approval-meta-grid">
          <span className="approval-meta-label">{idID.activity.approvals.riskLevel}</span>
          <span className="approval-meta-val">{approval.riskLevel}</span>

          <span className="approval-meta-label">{idID.activity.approvals.consequence}</span>
          <span className="approval-meta-val">{approval.consequence || 'Tidak ada catatan konsekuensi'}</span>

          <span className="approval-meta-label">{idID.activity.approvals.resource}</span>
          <span className="approval-meta-val">{approval.resource || '-'}</span>

          <span className="approval-meta-label">{idID.activity.approvals.scope}</span>
          <span className="approval-meta-val">{approval.scope || 'session'}</span>

          {approval.expiresAt && (
            <>
              <span className="approval-meta-label">{idID.activity.approvals.expiresAt}</span>
              <span className="approval-meta-val">
                {new Date(approval.expiresAt).toLocaleTimeString()}
              </span>
            </>
          )}
        </div>

        {/* Reason field (optional) if status is pending */}
        {approval.status === 'pending' && (
          <input
            type="text"
            className="approval-reason-input"
            placeholder={idID.activity.approvals.reasonPlaceholder}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={loading}
          />
        )}

        {/* Action buttons */}
        {approval.status === 'pending' ? (
          <div className="approval-action-btns">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleActionClick('deny')}
              disabled={loading}
            >
              <X size={14} />
              <span>{idID.activity.approvals.deny}</span>
            </Button>
            <Button
              variant={isHighRisk ? 'danger' : 'primary'}
              size="sm"
              onClick={() => handleActionClick('approve')}
              disabled={loading}
            >
              <Check size={14} />
              <span>{idID.activity.approvals.approve}</span>
            </Button>
          </div>
        ) : (
          <div className="card-meta-row">
            <span>Status:</span>
            <span className={`status-pill ${approval.status}`}>{approval.status}</span>
          </div>
        )}
      </div>

      {/* Confirmation Dialog for HIGH / CRITICAL Decisions */}
      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={
          pendingDecision === 'deny'
            ? idID.activity.approvals.confirmDenyTitle
            : idID.activity.approvals.confirmTitle
        }
      >
        <div className="settings-form-group">
          <p className="settings-card-subtitle">
            {pendingDecision === 'deny'
              ? idID.activity.approvals.confirmDenyBody(approval.action)
              : idID.activity.approvals.confirmBody(approval.action, approval.resource || 'sistem')}
          </p>

          <div className="approval-meta-grid">
            <span className="approval-meta-label">{idID.activity.approvals.riskLevel}</span>
            <span className="approval-meta-val text-rose">{approval.riskLevel}</span>

            <span className="approval-meta-label">{idID.activity.approvals.consequence}</span>
            <span className="approval-meta-val">{approval.consequence}</span>
          </div>

          <div className="approval-action-btns">
            <Button variant="secondary" size="sm" onClick={() => setDialogOpen(false)} disabled={loading}>
              {idID.common.cancel}
            </Button>
            <Button
              variant={pendingDecision === 'deny' ? 'secondary' : 'danger'}
              size="sm"
              onClick={() => {
                if (pendingDecision) {
                  void executeDecision(pendingDecision);
                }
              }}
              disabled={loading}
            >
              {pendingDecision === 'deny'
                ? idID.activity.approvals.deny
                : idID.activity.approvals.approve}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
};
