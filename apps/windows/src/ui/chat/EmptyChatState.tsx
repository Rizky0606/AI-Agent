import React from 'react';
import { Sparkles } from 'lucide-react';
import { idID } from '../locales/id-ID.ts';

export const samplePrompts = idID.chat.samplePrompts;

interface EmptyChatStateProps {
  onSelectPrompt: (prompt: string) => void;
}

export const EmptyChatState: React.FC<EmptyChatStateProps> = ({ onSelectPrompt }) => {
  return (
    <div className="empty-chat-state" aria-label="Percakapan Baru">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-xl)',
            background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(59, 130, 246, 0.15))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-cyan)',
          }}
        >
          <Sparkles size={24} />
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
          {idID.chat.emptyTitle}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-sub)', maxWidth: 480, margin: 0, lineHeight: 1.5 }}>
          {idID.chat.emptySubtitle}
        </p>
      </div>

      <div className="empty-chat-prompts-grid" role="list" aria-label="Contoh Pertanyaan">
        {idID.chat.samplePrompts.map((item) => (
          <button
            key={item.title}
            type="button"
            className="empty-prompt-card"
            onClick={() => onSelectPrompt(item.prompt)}
            role="listitem"
          >
            <span className="empty-prompt-title">{item.title}</span>
            <span className="empty-prompt-text">{item.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
