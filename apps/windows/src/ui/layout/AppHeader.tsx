import React from 'react';
import { PanelLeft, MessageSquare, FolderGit2, Brain, Wrench, Settings, Bell } from 'lucide-react';
import { useAgentStore } from '../context.ts';
import { StatusDot, type StatusDotKind } from '../components/StatusDot.tsx';
import { ThemeSwitcher } from '../components/ThemeSwitcher.tsx';
import { idID } from '../locales/id-ID.ts';

export type ActiveView = 'chat' | 'project' | 'memory' | 'skills' | 'settings';

interface AppHeaderProps {
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  onToggleSidebar: () => void;
  onToggleActivity: () => void;
  pendingApprovalsCount: number;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeView,
  onChangeView,
  onToggleSidebar,
  onToggleActivity,
  pendingApprovalsCount,
}) => {
  const { connectionStatus } = useAgentStore();

  return (
    <header className="app-header" aria-label="Navigasi Utama">
      <div className="header-left-actions">
        {/* Toggle sidebar button */}
        <button
          className="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-md"
          onClick={onToggleSidebar}
          title={idID.nav.toggleSidebar}
          aria-label={idID.nav.toggleSidebar}
        >
          <PanelLeft size={18} />
        </button>

        {/* View switcher tabs */}
        <nav className="header-nav-tabs" aria-label="Tampilan Utama">
          <button
            className={`header-nav-btn ${activeView === 'chat' ? 'active' : ''}`}
            onClick={() => onChangeView('chat')}
            aria-current={activeView === 'chat' ? 'page' : undefined}
          >
            <MessageSquare size={15} />
            <span>{idID.nav.chat}</span>
          </button>
          <button
            className={`header-nav-btn ${activeView === 'project' ? 'active' : ''}`}
            onClick={() => onChangeView('project')}
            aria-current={activeView === 'project' ? 'page' : undefined}
          >
            <FolderGit2 size={15} />
            <span>{idID.nav.project}</span>
          </button>
          <button
            className={`header-nav-btn ${activeView === 'memory' ? 'active' : ''}`}
            onClick={() => onChangeView('memory')}
            aria-current={activeView === 'memory' ? 'page' : undefined}
          >
            <Brain size={15} />
            <span>{idID.nav.memory}</span>
          </button>
          <button
            className={`header-nav-btn ${activeView === 'skills' ? 'active' : ''}`}
            onClick={() => onChangeView('skills')}
            aria-current={activeView === 'skills' ? 'page' : undefined}
          >
            <Wrench size={15} />
            <span>{idID.nav.skills}</span>
          </button>
          <button
            className={`header-nav-btn ${activeView === 'settings' ? 'active' : ''}`}
            onClick={() => onChangeView('settings')}
            aria-current={activeView === 'settings' ? 'page' : undefined}
          >
            <Settings size={15} />
            <span>{idID.nav.settings}</span>
          </button>
        </nav>
      </div>

      <div className="header-right-actions">
        {/* Compact connection status */}
        <div className="status-badge-compact" title={`${idID.sidebar.connection} ${idID.status[connectionStatus as StatusDotKind] ?? connectionStatus}`}>
          <StatusDot status={connectionStatus as StatusDotKind} pulse={connectionStatus === 'connecting' || connectionStatus === 'reconnecting'} />
          <span>{idID.status[connectionStatus as StatusDotKind] ?? connectionStatus}</span>
        </div>

        {/* Theme Switcher */}
        <ThemeSwitcher />

        {/* Activity drawer toggle with pending approval badge */}
        <button
          className="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-md"
          onClick={onToggleActivity}
          style={{ position: 'relative' }}
          title={idID.nav.toggleActivity}
          aria-label={idID.nav.toggleActivity}
        >
          <Bell size={18} />
          {pendingApprovalsCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                backgroundColor: 'var(--accent-rose)',
                color: '#ffffff',
                fontSize: 10,
                fontWeight: 700,
                width: 16,
                height: 16,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 0 2px var(--bg-card)',
              }}
            >
              {pendingApprovalsCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
