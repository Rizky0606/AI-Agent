import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAgentStore } from './context.ts';
import { Drawer } from './components/Drawer.tsx';
import { ToastProvider, useToast } from './components/Toast.tsx';
import { LoginScreen } from './LoginScreen.tsx';
import { Sidebar } from './layout/Sidebar.tsx';
import { AppHeader, type ActiveView } from './layout/AppHeader.tsx';
import { ChatView } from './chat/ChatView.tsx';
import { ProjectView } from './project/ProjectView.tsx';
import { MemoryView } from './memory/MemoryView.tsx';
import { SettingsView } from './settings/SettingsView.tsx';
import { ActivityPanel } from './activity/ActivityPanel.tsx';
import { idID } from './locales/id-ID.ts';

import './Theme.css';
import './components/Components.css';
import './layout/Layout.css';

/**
 * Inner shell of the Personal AI OS Windows application.
 * Manages responsive layout, drawer state, keyboard navigation, and notifications.
 */
const AppShell: React.FC = () => {
  const {
    authState,
    bootstrapAuth,
    syncDeviceIdentity,
    approvals,
    newConversation,
    setActiveConversation,
  } = useAgentStore();

  const { warning } = useToast();

  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Bootstrap auth credentials on app mount
  useEffect(() => {
    void bootstrapAuth();
  }, [bootstrapAuth]);

  // Sync device identity once authenticated
  useEffect(() => {
    if (authState === 'authenticated') {
      void syncDeviceIdentity();
    }
  }, [authState, syncDeviceIdentity]);

  // Responsive: automatically collapse sidebar when window width is under 900px
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 900) {
        setIsSidebarCollapsed(true);
      }
    };

    // Run check on initial mount
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Keyboard navigation shortcuts: Ctrl+N (new chat) and Ctrl+K (focus search)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+N or Cmd+N: New conversation
      if ((event.ctrlKey || event.metaKey) && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault();
        newConversation();
        setActiveView('chat');
      }

      // Ctrl+K or Cmd+K: Focus conversation search input
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        setIsSidebarCollapsed(false);
        // Small delay to ensure sidebar transition allows focus
        setTimeout(() => {
          searchInputRef.current?.focus();
        }, 60);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [newConversation]);

  // Toast notification when new pending approvals arrive
  const pendingApprovals = approvals.filter((item) => item.status === 'pending');
  const pendingCount = pendingApprovals.length;
  const prevPendingCountRef = useRef(pendingCount);

  useEffect(() => {
    if (pendingCount > prevPendingCountRef.current) {
      const latest = pendingApprovals[pendingApprovals.length - 1];
      if (latest) {
        warning(idID.activity.approvals.newApprovalNotification(latest.action), 5000);
      }
    }
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, pendingApprovals, warning]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveConversation(id);
      setActiveView('chat');
    },
    [setActiveConversation],
  );

  const handleOpenSettings = useCallback(() => {
    setActiveView('settings');
  }, []);

  if (authState !== 'authenticated') {
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      {/* Left Collapsible Sidebar */}
      <Sidebar
        collapsed={isSidebarCollapsed}
        onSelectConversation={handleSelectConversation}
        onOpenSettings={handleOpenSettings}
        searchInputRef={searchInputRef}
      />

      {/* Main Center Area */}
      <div className="app-main">
        <AppHeader
          activeView={activeView}
          onChangeView={setActiveView}
          onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
          onToggleActivity={() => setIsActivityOpen((prev) => !prev)}
          pendingApprovalsCount={pendingCount}
        />

        {activeView === 'chat' && <ChatView />}
        {activeView === 'project' && <ProjectView />}
        {activeView === 'memory' && <MemoryView />}
        {activeView === 'settings' && <SettingsView />}
      </div>

      {/* Right Activity Drawer */}
      <Drawer
        isOpen={isActivityOpen}
        onClose={() => setIsActivityOpen(false)}
        title={idID.activity.title}
      >
        <ActivityPanel />
      </Drawer>
    </div>
  );
};

/**
 * Root App component providing global toast context.
 */
export const App: React.FC = () => {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
};
