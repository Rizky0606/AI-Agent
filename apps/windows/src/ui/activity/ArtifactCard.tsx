import React from 'react';
import { FileText, FileCode, Image, Eye } from 'lucide-react';
import type { ArtifactItem } from '../../api/client.ts';
import { idID } from '../locales/id-ID.ts';

interface ArtifactCardProps {
  artifact: ArtifactItem;
  onPreview: (artifactId: string) => void;
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getMimeIcon = (mimeType: string, filename: string) => {
  const lowerName = filename.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (
    lowerMime.includes('javascript') ||
    lowerMime.includes('typescript') ||
    lowerMime.includes('json') ||
    lowerName.endsWith('.ts') ||
    lowerName.endsWith('.tsx') ||
    lowerName.endsWith('.js') ||
    lowerName.endsWith('.json') ||
    lowerName.endsWith('.py') ||
    lowerName.endsWith('.rs')
  ) {
    return <FileCode size={16} className="text-cyan flex-shrink-0" />;
  }
  if (lowerMime.startsWith('image/')) {
    return <Image size={16} className="text-emerald flex-shrink-0" />;
  }
  return <FileText size={16} className="text-cyan flex-shrink-0" />;
};

export const ArtifactCard: React.FC<ArtifactCardProps> = ({ artifact, onPreview }) => {
  return (
    <div className="activity-card">
      <div className="card-header-row">
        <div className="conversation-item-inner">
          {getMimeIcon(artifact.mimeType, artifact.filename)}
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
        <span className="artifact-size-badge" title={`${artifact.size} bytes`}>
          {formatFileSize(artifact.size)}
        </span>
      </div>

      {artifact.taskId && (
        <div className="card-meta-row">
          <span>Tugas: <code>{artifact.taskId.slice(0, 8)}...</code></span>
        </div>
      )}
    </div>
  );
};
