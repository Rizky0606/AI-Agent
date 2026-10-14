import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { theme } from '../components/Theme.ts';
import { ApprovalInboxScreen } from '../screens/ApprovalInboxScreen.tsx';
import { ArtifactsScreen } from '../screens/ArtifactsScreen.tsx';
import { ChatScreen } from '../screens/ChatScreen.tsx';
import { ConversationListScreen } from '../screens/ConversationListScreen.tsx';
import { LoginScreen } from '../screens/LoginScreen.tsx';
import { ProjectsScreen } from '../screens/ProjectsScreen.tsx';
import { SettingsScreen } from '../screens/SettingsScreen.tsx';
import { TaskDetailScreen } from '../screens/TaskDetailScreen.tsx';
import { TaskListScreen } from '../screens/TaskListScreen.tsx';
import { DeepLinkService, type DeepLinkTarget } from '../services/deep-link.ts';
import { defaultFcmService } from '../services/fcm-service.ts';
import { useAuthStore } from '../state/auth-store.ts';
import { useUiStore } from '../state/ui-store.ts';

type Tab = 'chat' | 'tasks' | 'approvals' | 'projects' | 'settings';

export const AppNavigator: React.FC = () => {
  const { isAuthenticated, isLoading, initialize } = useAuthStore();
  const { toastMessage, clearToast } = useUiStore();

  const [currentTab, setCurrentTab] = useState<Tab>('chat');

  // Sub-screen navigation states
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationTitle, setActiveConversationTitle] = useState<string | undefined>(
    undefined,
  );
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showingArtifacts, setShowingArtifacts] = useState(false);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(clearToast, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage, clearToast]);

  const handleDeepLinkTarget = (target: DeepLinkTarget | null) => {
    if (!target) return;
    if (target.screen === 'Chat') {
      setCurrentTab('chat');
      setActiveConversationId(target.conversationId);
    } else if (target.screen === 'ApprovalDetail') {
      setCurrentTab('approvals');
    } else if (target.screen === 'TaskDetail') {
      setCurrentTab('tasks');
      setActiveTaskId(target.taskId);
    } else if (target.screen === 'ProjectDetail') {
      setCurrentTab('projects');
    }
  };

  // Wire FCM Push notification receiver to show toast and auto-route
  useEffect(() => {
    const unsubscribe = defaultFcmService.onNotificationReceived((payload) => {
      const title = payload.title ?? 'Notifikasi';
      const body = payload.body ?? '';
      useUiStore.getState().showToast(`${title}: ${body}`);

      if (payload.data?.deepLink) {
        const target = DeepLinkService.parseUrl(payload.data.deepLink);
        handleDeepLinkTarget(target);
      } else if (payload.data?.approvalId) {
        handleDeepLinkTarget({ screen: 'ApprovalDetail', approvalId: payload.data.approvalId });
      } else if (payload.data?.taskId) {
        handleDeepLinkTarget({ screen: 'TaskDetail', taskId: payload.data.taskId });
      }
    });
    return unsubscribe;
  }, []);

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  const renderTabContent = () => {
    switch (currentTab) {
      case 'chat':
        if (activeConversationId) {
          return (
            <ChatScreen
              conversationId={activeConversationId}
              conversationTitle={activeConversationTitle}
              onBack={() => {
                setActiveConversationId(null);
                setActiveConversationTitle(undefined);
              }}
            />
          );
        }
        return (
          <ConversationListScreen
            onSelectConversation={(id, title) => {
              setActiveConversationId(id);
              setActiveConversationTitle(title);
            }}
          />
        );

      case 'tasks':
        if (activeTaskId) {
          return (
            <TaskDetailScreen
              taskId={activeTaskId}
              onBack={() => setActiveTaskId(null)}
              onNavigateToApproval={() => {
                setActiveTaskId(null);
                setCurrentTab('approvals');
              }}
            />
          );
        }
        return <TaskListScreen onSelectTask={(id) => setActiveTaskId(id)} />;

      case 'approvals':
        return <ApprovalInboxScreen />;

      case 'projects':
        return <ProjectsScreen />;

      case 'settings':
        if (showingArtifacts) {
          return <ArtifactsScreen />;
        }
        return <SettingsScreen onNavigateToArtifacts={() => setShowingArtifacts(true)} />;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.background} />

      {/* Main Screen Content */}
      <View style={styles.contentContainer}>{renderTabContent()}</View>

      {/* Floating Toast Notice */}
      {toastMessage ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      {/* Bottom Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => {
            setShowingArtifacts(false);
            setCurrentTab('chat');
          }}
        >
          <Text style={[styles.tabIcon, currentTab === 'chat' && styles.tabActive]}>💬</Text>
          <Text style={[styles.tabLabel, currentTab === 'chat' && styles.tabActive]}>Chat</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => {
            setShowingArtifacts(false);
            setCurrentTab('tasks');
          }}
        >
          <Text style={[styles.tabIcon, currentTab === 'tasks' && styles.tabActive]}>📋</Text>
          <Text style={[styles.tabLabel, currentTab === 'tasks' && styles.tabActive]}>Tasks</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => {
            setShowingArtifacts(false);
            setCurrentTab('approvals');
          }}
        >
          <Text style={[styles.tabIcon, currentTab === 'approvals' && styles.tabActive]}>🛡️</Text>
          <Text style={[styles.tabLabel, currentTab === 'approvals' && styles.tabActive]}>
            Approval
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => {
            setShowingArtifacts(false);
            setCurrentTab('projects');
          }}
        >
          <Text style={[styles.tabIcon, currentTab === 'projects' && styles.tabActive]}>📁</Text>
          <Text style={[styles.tabLabel, currentTab === 'projects' && styles.tabActive]}>
            Workspace
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => {
            setShowingArtifacts(false);
            setCurrentTab('settings');
          }}
        >
          <Text style={[styles.tabIcon, currentTab === 'settings' && styles.tabActive]}>⚙️</Text>
          <Text style={[styles.tabLabel, currentTab === 'settings' && styles.tabActive]}>
            Setting
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  contentContainer: {
    flex: 1,
  },
  toast: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.primary,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    elevation: 6,
    zIndex: 999,
  },
  toastText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.surfaceBorder,
    paddingVertical: theme.spacing.xs,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  tabIcon: {
    fontSize: 18,
    opacity: 0.6,
  },
  tabLabel: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    fontWeight: '600',
    marginTop: 2,
  },
  tabActive: {
    opacity: 1,
    color: theme.colors.primary,
  },
});
