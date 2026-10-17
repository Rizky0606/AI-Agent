import React from 'react';
import { Sparkles, FileText, Code, Search, Terminal } from 'lucide-react';
import { idID } from '../locales/id-ID.ts';

export const samplePrompts = idID.chat.samplePrompts;

interface EmptyChatStateProps {
  onSelectPrompt: (prompt: string) => void;
}

const PROMPT_ICONS = [
  <FileText key="arch" size={14} className="empty-prompt-icon" />,
  <Code key="code" size={14} className="empty-prompt-icon" />,
  <Search key="search" size={14} className="empty-prompt-icon" />,
  <Terminal key="script" size={14} className="empty-prompt-icon" />,
];

export const EmptyChatState: React.FC<EmptyChatStateProps> = ({ onSelectPrompt }) => {
  return (
    <div className="empty-chat-state" aria-label="Percakapan Baru">
      <div className="empty-chat-header">
        <div className="empty-chat-icon-badge">
          <Sparkles size={22} />
        </div>
        <h2 className="empty-chat-title">
          {idID.chat.emptyTitle}
        </h2>
        <p className="empty-chat-subtitle">
          {idID.chat.emptySubtitle}
        </p>
      </div>

      <div className="empty-chat-prompts-grid" role="list" aria-label="Contoh Pertanyaan">
        {idID.chat.samplePrompts.map((item, idx) => (
          <button
            key={item.title}
            type="button"
            className="empty-prompt-card"
            onClick={() => onSelectPrompt(item.prompt)}
            role="listitem"
          >
            <div className="empty-prompt-header-row">
              {PROMPT_ICONS[idx % PROMPT_ICONS.length]}
              <span className="empty-prompt-title">{item.title}</span>
            </div>
            <span className="empty-prompt-text">{item.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
