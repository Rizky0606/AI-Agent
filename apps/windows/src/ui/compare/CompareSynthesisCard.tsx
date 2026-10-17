import React, { useState } from 'react';
import { Sparkles, Copy, Check } from 'lucide-react';
import { idID } from '../locales/id-ID.ts';

interface CompareSynthesisCardProps {
  synthesis: string;
  synthesisModelId: string | null;
}

export const CompareSynthesisCard: React.FC<CompareSynthesisCardProps> = ({
  synthesis,
  synthesisModelId,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(synthesis);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="compare-synthesis-card">
      <div className="compare-synthesis-header">
        <div className="compare-synthesis-title-row">
          <Sparkles size={16} color="var(--accent-purple, #a855f7)" />
          <span>Sintesis Perbandingan</span>
          {synthesisModelId && (
            <span className="compare-synthesis-model-pill">
              {idID.compare.synthesizedBy(synthesisModelId)}
            </span>
          )}
        </div>

        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-xs"
          onClick={handleCopy}
          title="Salin Sintesis"
        >
          {copied ? <Check size={13} color="var(--color-success, #10b981)" /> : <Copy size={13} />}
          <span>{copied ? idID.compare.copied : 'Salin Sintesis'}</span>
        </button>
      </div>

      <div className="compare-synthesis-body">{synthesis}</div>
    </div>
  );
};
