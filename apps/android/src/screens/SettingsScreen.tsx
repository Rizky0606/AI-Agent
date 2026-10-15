import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Bell,
  Box,
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cpu,
  FolderKanban,
  LogOut,
  Moon,
  Palette,
  Server,
  Settings,
  Sun,
  User,
  Wrench,
} from 'lucide-react-native';
import { ModelSelectorModal } from '../components/ModelSelectorModal.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useHealth } from '../hooks/use-queries.ts';
import { idID } from '../locales/id-ID.ts';
import { useAuthStore } from '../state/auth-store.ts';
import { useChatStore } from '../state/chat-store.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface SettingsScreenProps {
  onNavigateToArtifacts?: () => void;
  onNavigateToProjects?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  onNavigateToArtifacts,
  onNavigateToProjects,
}) => {
  const theme = useAppTheme();
  const { user, device, serverUrl, logout } = useAuthStore();
  const {
    theme: themePreference,
    setTheme,
    pushNotificationsEnabled,
    setPushNotificationsEnabled,
  } = useUiStore();
  const { userDefaultModel } = useChatStore();
  const { data: health, isLoading: healthLoading } = useHealth();

  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}
    >
      <Text
        style={[styles.screenTitle, { color: theme.colors.textPrimary }]}
        accessibilityRole="header"
      >
        {idID.more.title}
      </Text>

      {/* 1. Akun Pengguna */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <User size={18} color={theme.colors.primary} />
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
            {idID.more.sectionAccount}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
            {idID.more.accountDesc}
          </Text>
          <Text
            style={[styles.infoValue, { color: theme.colors.textPrimary }]}
            numberOfLines={1}
          >
            {user?.email ?? 'user@example.com'}
          </Text>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={idID.common.logout}
          style={[
            styles.logoutBtn,
            {
              backgroundColor: theme.colors.dangerBg,
              borderColor: theme.colors.danger,
            },
          ]}
          onPress={() => void logout()}
        >
          <LogOut size={16} color={theme.colors.danger} />
          <Text style={[styles.logoutBtnText, { color: theme.colors.danger }]}>
            {idID.common.logout}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 2. Model Default */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <Cpu size={18} color={theme.colors.primary} />
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
            {idID.more.sectionModel}
          </Text>
        </View>

        <Text style={[styles.cardDesc, { color: theme.colors.textSecondary }]}>
          {idID.more.defaultModelDesc}
        </Text>

        <View
          style={[
            styles.modelBox,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <Text style={[styles.modelName, { color: theme.colors.textPrimary }]}>
            🧠 {userDefaultModel ?? 'Auto (Disarankan oleh Gateway)'}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={idID.more.changeModelButton}
            style={[styles.changeModelBtn, { backgroundColor: theme.colors.primary }]}
            onPress={() => setIsModelModalOpen(true)}
          >
            <Text style={styles.changeModelBtnText}>
              {idID.more.changeModelButton}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 3. Notifikasi */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <Bell size={18} color={theme.colors.primary} />
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
            {idID.more.sectionNotifications}
          </Text>
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchTextContainer}>
            <Text style={[styles.switchLabel, { color: theme.colors.textPrimary }]}>
              {idID.more.pushNotificationToggle}
            </Text>
            <Text style={[styles.switchDesc, { color: theme.colors.textMuted }]}>
              {idID.more.pushNotificationDesc}
            </Text>
          </View>
          <Switch
            value={pushNotificationsEnabled}
            onValueChange={setPushNotificationsEnabled}
            trackColor={{
              false: theme.colors.surfaceElevated,
              true: theme.colors.primary,
            }}
            accessibilityLabel={idID.more.pushNotificationToggle}
          />
        </View>
      </View>

      {/* 4. Tampilan (Sistem / Terang / Gelap) */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <Palette size={18} color={theme.colors.primary} />
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
            {idID.more.sectionAppearance}
          </Text>
        </View>

        <Text style={[styles.cardDesc, { color: theme.colors.textSecondary }]}>
          {idID.more.themeDesc}
        </Text>

        <View style={styles.themeOptionsRow}>
          {[
            { id: 'system', label: idID.more.themeSystem, icon: Settings },
            { id: 'light', label: idID.more.themeLight, icon: Sun },
            { id: 'dark', label: idID.more.themeDark, icon: Moon },
          ].map((item) => {
            const isSelected = themePreference === item.id;
            const Icon = item.icon;
            return (
              <TouchableOpacity
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                style={[
                  styles.themeOptionBtn,
                  {
                    backgroundColor: isSelected
                      ? theme.colors.primary
                      : theme.colors.surfaceElevated,
                    borderColor: isSelected
                      ? theme.colors.primary
                      : theme.colors.surfaceBorder,
                  },
                ]}
                onPress={() => setTheme(item.id as 'system' | 'light' | 'dark')}
              >
                <Icon
                  size={16}
                  color={isSelected ? '#fff' : theme.colors.textSecondary}
                />
                <Text
                  style={[
                    styles.themeOptionText,
                    {
                      color: isSelected ? '#fff' : theme.colors.textPrimary,
                      fontWeight: isSelected ? '700' : '600',
                    },
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 5. Memori (Kerangka Sesi 10) */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <Brain size={18} color={theme.colors.primary} />
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
            {idID.more.sectionMemory}
          </Text>
          <View
            style={[
              styles.comingSoonBadge,
              { backgroundColor: theme.colors.surfaceElevated },
            ]}
          >
            <Text style={[styles.comingSoonText, { color: theme.colors.primary }]}>
              Sesi 10
            </Text>
          </View>
        </View>

        <Text style={[styles.cardDesc, { color: theme.colors.textMuted }]}>
          {idID.more.memoryScaffoldDesc}
        </Text>
      </View>

      {/* 6. Skill & MCP (Kerangka Sesi 14) */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <Wrench size={18} color={theme.colors.primary} />
          <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
            {idID.more.sectionSkills}
          </Text>
          <View
            style={[
              styles.comingSoonBadge,
              { backgroundColor: theme.colors.surfaceElevated },
            ]}
          >
            <Text style={[styles.comingSoonText, { color: theme.colors.primary }]}>
              Sesi 14
            </Text>
          </View>
        </View>

        <Text style={[styles.cardDesc, { color: theme.colors.textMuted }]}>
          {idID.more.skillsScaffoldDesc}
        </Text>
      </View>

      {/* 7. Lanjutan (Collapsible) */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={idID.more.sectionAdvanced}
          style={styles.advancedAccordionHeader}
          onPress={() => setShowAdvanced(!showAdvanced)}
        >
          <View style={styles.cardHeader}>
            <Server size={18} color={theme.colors.textSecondary} />
            <Text style={[styles.cardTitle, { color: theme.colors.textPrimary }]}>
              {idID.more.sectionAdvanced}
            </Text>
          </View>
          {showAdvanced ? (
            <ChevronUp size={20} color={theme.colors.textSecondary} />
          ) : (
            <ChevronDown size={20} color={theme.colors.textSecondary} />
          )}
        </TouchableOpacity>

        {showAdvanced ? (
          <View style={styles.advancedContent}>
            {/* Server Endpoint */}
            <View style={styles.diagRow}>
              <Text style={[styles.diagLabel, { color: theme.colors.textMuted }]}>
                {idID.more.serverEndpointLabel}:
              </Text>
              <Text
                style={[styles.diagValue, { color: theme.colors.textSecondary }]}
              >
                {serverUrl}
              </Text>
            </View>

            {/* Device ID */}
            <View style={styles.diagRow}>
              <Text style={[styles.diagLabel, { color: theme.colors.textMuted }]}>
                {idID.more.deviceIdLabel}:
              </Text>
              <Text
                style={[styles.diagValue, { color: theme.colors.textSecondary }]}
                numberOfLines={1}
              >
                {device?.id ?? 'Belum terdaftar'}
              </Text>
            </View>

            {/* User ID */}
            <View style={styles.diagRow}>
              <Text style={[styles.diagLabel, { color: theme.colors.textMuted }]}>
                {idID.more.userIdLabel}:
              </Text>
              <Text
                style={[styles.diagValue, { color: theme.colors.textSecondary }]}
                numberOfLines={1}
              >
                {user?.id ?? 'Belum ada'}
              </Text>
            </View>

            {/* Health Grid */}
            <View
              style={[
                styles.healthGrid,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                },
              ]}
            >
              <Text
                style={[styles.healthGridTitle, { color: theme.colors.textPrimary }]}
              >
                {idID.more.systemStatusTitle}
              </Text>

              {healthLoading ? (
                <ActivityIndicator
                  size="small"
                  color={theme.colors.primary}
                  style={{ marginTop: 8 }}
                />
              ) : health ? (
                <View style={styles.healthList}>
                  <View style={styles.healthRow}>
                    <Text
                      style={[
                        styles.healthRowText,
                        { color: theme.colors.textSecondary },
                      ]}
                    >
                      {idID.more.dbLabel}
                    </Text>
                    <StatusPill status={health.database} />
                  </View>

                  <View style={styles.healthRow}>
                    <Text
                      style={[
                        styles.healthRowText,
                        { color: theme.colors.textSecondary },
                      ]}
                    >
                      {idID.more.redisLabel}
                    </Text>
                    <StatusPill status={health.redis} />
                  </View>

                  <View style={styles.healthRow}>
                    <Text
                      style={[
                        styles.healthRowText,
                        { color: theme.colors.textSecondary },
                      ]}
                    >
                      {idID.more.apiLabel}
                    </Text>
                    <StatusPill
                      status={health.status === 'ready' ? 'connected' : 'disconnected'}
                    />
                  </View>
                </View>
              ) : (
                <Text style={[styles.offlineText, { color: theme.colors.danger }]}>
                  Tidak dapat menghubungi server backend.
                </Text>
              )}
            </View>

            {/* Secondary navigation to Artifacts & Projects */}
            <View style={styles.navLinksContainer}>
              {onNavigateToArtifacts ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={idID.more.openArtifacts}
                  style={[
                    styles.navLinkBtn,
                    {
                      backgroundColor: theme.colors.surfaceElevated,
                      borderColor: theme.colors.surfaceBorder,
                    },
                  ]}
                  onPress={onNavigateToArtifacts}
                >
                  <View style={styles.navLinkLeft}>
                    <Box size={16} color={theme.colors.primary} />
                    <Text
                      style={[
                        styles.navLinkText,
                        { color: theme.colors.textPrimary },
                      ]}
                    >
                      {idID.more.openArtifacts}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={theme.colors.textMuted} />
                </TouchableOpacity>
              ) : null}

              {onNavigateToProjects ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={idID.more.openProjects}
                  style={[
                    styles.navLinkBtn,
                    {
                      backgroundColor: theme.colors.surfaceElevated,
                      borderColor: theme.colors.surfaceBorder,
                    },
                  ]}
                  onPress={onNavigateToProjects}
                >
                  <View style={styles.navLinkLeft}>
                    <FolderKanban size={16} color={theme.colors.primary} />
                    <Text
                      style={[
                        styles.navLinkText,
                        { color: theme.colors.textPrimary },
                      ]}
                    >
                      {idID.more.openProjects}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={theme.colors.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>

      {/* Model Selector Sheet */}
      <ModelSelectorModal
        visible={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 36,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 16,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  infoLabel: {
    fontSize: 13,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    maxWidth: '65%',
  },
  logoutBtn: {
    marginTop: 14,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoutBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  modelBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  modelName: {
    fontSize: 13,
    fontWeight: '600',
  },
  changeModelBtn: {
    minHeight: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  changeModelBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchTextContainer: {
    flex: 1,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  switchDesc: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  themeOptionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  themeOptionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  themeOptionText: {
    fontSize: 12,
  },
  comingSoonBadge: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  comingSoonText: {
    fontSize: 11,
    fontWeight: '700',
  },
  advancedAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  advancedContent: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.2)',
    paddingTop: 12,
  },
  diagRow: {
    marginVertical: 4,
  },
  diagLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  diagValue: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  healthGrid: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  healthGridTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  healthList: {
    gap: 8,
  },
  healthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  healthRowText: {
    fontSize: 12,
  },
  offlineText: {
    fontSize: 12,
    marginTop: 4,
  },
  navLinksContainer: {
    marginTop: 14,
    gap: 8,
  },
  navLinkBtn: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  navLinkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  navLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
