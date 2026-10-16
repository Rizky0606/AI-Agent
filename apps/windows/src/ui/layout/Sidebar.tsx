import React, { useState } from 'react';
import { Plus, Search, MessageSquare, LogOut, FolderGit2, Settings } from 'lucide-react';
import { useAgentStore } from '../context.ts';
import type { ChatConversation } from '../../state/agent-store.ts';
import { StatusDot, type StatusDotKind } from '../components/StatusDot.tsx';
import { groupConversations } from '../chat/conversation-grouping.ts';
import { idID } from '../locales/id-ID.ts';

interface SidebarProps {
  collapsed: boolean;
  onSelectConversation: (id: string) => void;
  onOpenSettings: () => void;
  onSelectProject?: (root: string) => void;
  searchInputRef?: React.Ref<HTMLInputElement>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onSelectConversation,
  onOpenSettings,
  onSelectProject,
  searchInputRef,
}) => {
  const {
    conversations,
    activeConversationId,
    newConversation,
    connectionStatus,
    userEmail,
    logout,
    allowedRoots,
  } = useAgentStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoot, setSelectedRoot] = useState<string>(allowedRoots[0] ?? '');

  // Filter conversations by search query
  const filtered = conversations.filter((item) => {
    if (!item.id) return false;
    if (!searchQuery.trim()) return true;
    return (item.title || '').toLowerCase().includes(searchQuery.toLowerCase());
  });

  const grouped = groupConversations(filtered);

  const handleRootChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedRoot(val);
    if (onSelectProject) {
      onSelectProject(val);
    }
  };

  const renderGroup = (title: string, list: ChatConversation[]) => {
    if (list.length === 0) return null;
    return (
      <div key={title} className="conversation-group">
        <div className="conversation-group-title">{title}</div>
        <div className="conversation-group-list">
          {list.map((conv) => {
            const isActive = conv.id === activeConversationId;
            return (
              <button
                key={conv.id}
                className={`conversation-item-btn ${isActive ? 'active' : ''}`}
                onClick={() => onSelectConversation(conv.id)}
                aria-current={isActive ? 'page' : undefined}
                title={conv.title}
              >
                <div className="conversation-item-inner">
                  <MessageSquare size={14} className="conversation-item-icon" />
                  <span className="conversation-item-title">
                    {conv.title || idID.chat.defaultTitle}
                  </span>
                </div>
                {conv.messages.length > 0 && (
                  <span className="conversation-item-meta">
                    {conv.messages.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <aside
      className={`app-sidebar ${collapsed ? 'collapsed' : ''}`}
      aria-label="Sidebar Percakapan"
    >
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="brand-icon">AI</div>
          <div className="brand-info">
            <span className="brand-title-text">{idID.brand.name}</span>
            <span className="brand-subtext">{idID.brand.windowsAgent}</span>
          </div>
        </div>

        {/* New chat button */}
        <button
          className="ui-btn ui-btn-primary ui-btn-sm sidebar-new-chat-btn"
          onClick={newConversation}
          title={`${idID.sidebar.newChat} (${idID.sidebar.newChatShortcut})`}
        >
          <Plus size={16} />
          <span>{idID.sidebar.newChat}</span>
        </button>

        {/* Search input */}
        <div className="sidebar-search-box">
          <Search size={14} className="sidebar-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="sidebar-search-input"
            placeholder={idID.sidebar.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={idID.sidebar.searchPlaceholder}
          />
        </div>
      </div>

      {/* Grouped conversations list */}
      <div className="sidebar-conversations" tabIndex={0} role="region" aria-label="Daftar Percakapan">
        {filtered.length === 0 ? (
          <div className="sidebar-empty-state">
            {searchQuery.trim() ? idID.sidebar.noSearchResults : idID.sidebar.noConversations}
          </div>
        ) : (
          <>
            {renderGroup(idID.sidebar.groups.today, grouped.today)}
            {renderGroup(idID.sidebar.groups.yesterday, grouped.yesterday)}
            {renderGroup(idID.sidebar.groups.older, grouped.older)}
          </>
        )}
      </div>

      {/* Project selector */}
      {allowedRoots.length > 0 && (
        <div className="sidebar-project-section">
          <div className="sidebar-project-label-row">
            <FolderGit2 size={13} />
            <span>{idID.sidebar.projectSelector}</span>
          </div>
          <select
            className="sidebar-project-select"
            value={selectedRoot || allowedRoots[0]}
            onChange={handleRootChange}
            aria-label={idID.sidebar.projectSelector}
          >
            {allowedRoots.map((root) => (
              <option key={root} value={root}>
                {root}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="user-profile-badge" title={userEmail || idID.sidebar.userAccount}>
          <div className="user-avatar-circle">
            {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
          </div>
          <div className="user-profile-text-col">
            <span className="user-email-text">{userEmail || idID.sidebar.userAccount}</span>
            <div className="user-status-row">
              <StatusDot status={connectionStatus as StatusDotKind} />
              <span className="user-status-text">
                {idID.status[connectionStatus as StatusDotKind] ?? connectionStatus}
              </span>
            </div>
          </div>
        </div>

        <div className="chat-error-actions">
          <button
            className="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
            onClick={onOpenSettings}
            title={idID.nav.settings}
            aria-label={idID.nav.settings}
          >
            <Settings size={16} />
          </button>
          <button
            className="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
            onClick={() => void logout()}
            title={idID.settings.account.logout}
            aria-label={idID.settings.account.logout}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
};
