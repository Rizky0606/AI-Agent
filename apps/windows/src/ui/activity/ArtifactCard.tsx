import React from 'react';
import { FileText, Eye } from 'lucide-react';
import type { ArtifactItem } from '../../api/client.ts';
import { idID } from '../locales/id-ID.ts';

interface ArtifactCardProps {
  artifact: ArtifactItem;
  onPreview: (artifactId: string) => void;
}

export const ArtifactCard: React.FC<ArtifactCardProps> = ({ artifact, onPreview }) => {
  return (
    <div className="activity-card">
      <div className="card-header-row">
        <div className="conversation-item-inner">
          <FileText size={16} className="text-cyan flex-shrink-0" />
          <strong className="card-title-text">
            {artifact.filename}
          </strong>
        </div>

        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-sm"
          onClick={() => onPreview(artifact.id)}
          title={idID.activity.artifacts.preview}
        >
          <Eye size={12} />
          <span>{idID.activity.artifacts.preview}</span>
        </button>
      </div>

      <div className="card-meta-row">
        <span>{artifact.mimeType}</span>
        <span>{idID.activity.artifacts.sizeBytes(artifact.size)}</span>
      </div>

      {artifact.taskId && (
        <div className="card-meta-row">
          <span>Tugas: <code>{artifact.taskId.slice(0, 8)}...</code></span>
        </div>
      )}
    </div>
  );
};
