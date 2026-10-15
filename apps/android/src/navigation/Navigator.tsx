import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { Activity, MessageSquare, MoreHorizontal } from 'lucide-react-native';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useApprovals } from '../hooks/use-queries.ts';
import { idID } from '../locales/id-ID.ts';
import { ActivityScreen } from '../screens/ActivityScreen.tsx';
import { ArtifactsScreen } from '../screens/ArtifactsScreen.tsx';
import { ChatScreen } from '../screens/ChatScreen.tsx';
import { ConversationListScreen } from '../screens/ConversationListScreen.tsx';
import { LoginScreen } from '../screens/LoginScreen.tsx';
import { ProjectsScreen } from '../screens/ProjectsScreen.tsx';
import { SettingsScreen } from '../screens/SettingsScreen.tsx';
import { TaskDetailScreen } from '../screens/TaskDetailScreen.tsx';
import { DeepLinkService, type DeepLinkTarget } from '../services/deep-link.ts';
import { defaultFcmService } from '../services/fcm-service.ts';
import { useAuthStore } from '../state/auth-store.ts';
import { useUiStore } from '../state/ui-store.ts';

const Tab = createBottomTabNavigator();
export const navigationRef = createNavigationContainerRef();

export const AppNavigator: React.FC = () => {
  const theme = useAppTheme();
  const { isAuthenticated, isLoading, initialize } = useAuthStore();
  const { toastMessage, clearToast } = useUiStore();

  // Navigation states for sub-screens
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationTitle, setActiveConversationTitle] = useState<string | undefined>(undefined);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activityInitialTab, setActivityInitialTab] = useState<'tasks' | 'approvals'>('tasks');
  const [moreSubscreen, setMoreSubscreen] = useState<'artifacts' | 'projects' | null>(null);

  // Pending approvals count for tab badge
  const { data: pendingApprovals } = useApprovals('pending');
  const pendingCount = pendingApprovals?.length ?? 0;

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
      setActiveConversationId(target.conversationId);
      if (navigationRef.isReady()) {
        (navigationRef as { navigate: (name: string) => void }).navigate('ChatTab');
      }
    } else if (target.screen === 'ApprovalDetail') {
      setActivityInitialTab('approvals');
      if (navigationRef.isReady()) {
        (navigationRef as { navigate: (name: string) => void }).navigate('ActivityTab');
      }
    } else if (target.screen === 'TaskDetail') {
      setActiveTaskId(target.taskId);
      if (navigationRef.isReady()) {
        (navigationRef as { navigate: (name: string) => void }).navigate('ActivityTab');
      }
    } else if (target.screen === 'ProjectDetail') {
      setMoreSubscreen('projects');
      if (navigationRef.isReady()) {
        (navigationRef as { navigate: (name: string) => void }).navigate('MoreTab');
      }
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
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // Subscreen renderers for tabs
  const renderChatStack = () => {
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
  };

  const renderActivityStack = () => {
    if (activeTaskId) {
      return (
        <TaskDetailScreen
          taskId={activeTaskId}
          onBack={() => setActiveTaskId(null)}
          onNavigateToApproval={() => {
            setActiveTaskId(null);
            setActivityInitialTab('approvals');
          }}
        />
      );
    }
    return (
      <ActivityScreen
        onSelectTask={(id) => setActiveTaskId(id)}
        initialTab={activityInitialTab}
      />
    );
  };

  const renderMoreStack = () => {
    if (moreSubscreen === 'artifacts') {
      return <ArtifactsScreen onBack={() => setMoreSubscreen(null)} />;
    }
    if (moreSubscreen === 'projects') {
      return <ProjectsScreen onBack={() => setMoreSubscreen(null)} />;
    }
    return (
      <SettingsScreen
        onNavigateToArtifacts={() => setMoreSubscreen('artifacts')}
        onNavigateToProjects={() => setMoreSubscreen('projects')}
      />
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <StatusBar
        barStyle={theme.scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
      />

      {/* Floating Toast Notice */}
      {toastMessage ? (
        <View
          style={[
            styles.toast,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.primary,
            },
          ]}
        >
          <Text style={[styles.toastText, { color: theme.colors.textPrimary }]}>
            {toastMessage}
          </Text>
        </View>
      ) : null}

      <NavigationContainer ref={navigationRef}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.surfaceBorder,
              borderTopWidth: 1,
              height: 60,
              paddingBottom: 6,
              paddingTop: 6,
            },
            tabBarItemStyle: {
              minHeight: 48,
              justifyContent: 'center',
              alignItems: 'center',
            },
            tabBarActiveTintColor: theme.colors.primary,
            tabBarInactiveTintColor: theme.colors.textSecondary,
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '600',
              marginTop: 2,
            },
          }}
        >
          <Tab.Screen
            name="ChatTab"
            options={{
              tabBarLabel: idID.nav.chat,
              tabBarAccessibilityLabel: idID.nav.chat,
              tabBarIcon: ({ color, size }) => (
                <MessageSquare size={size || 22} color={color} />
              ),
            }}
          >
            {renderChatStack}
          </Tab.Screen>

          <Tab.Screen
            name="ActivityTab"
            options={{
              tabBarLabel: idID.nav.activity,
              tabBarAccessibilityLabel: `${idID.nav.activity}${
                pendingCount > 0 ? `, ${pendingCount} pending` : ''
              }`,
              ...(pendingCount > 0
                ? {
                    tabBarBadge: pendingCount,
                    tabBarBadgeStyle: {
                      backgroundColor: theme.colors.riskHigh,
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: '800' as const,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      lineHeight: 16,
                    },
                  }
                : {}),
              tabBarIcon: ({ color, size }) => (
                <Activity size={size || 22} color={color} />
              ),
            }}
          >
            {renderActivityStack}
          </Tab.Screen>

          <Tab.Screen
            name="MoreTab"
            options={{
              tabBarLabel: idID.nav.more,
              tabBarAccessibilityLabel: idID.nav.more,
              tabBarIcon: ({ color, size }) => (
                <MoreHorizontal size={size || 22} color={color} />
              ),
            }}
          >
            {renderMoreStack}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toast: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    elevation: 6,
    zIndex: 9999,
    maxWidth: '90%',
  },
  toastText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
