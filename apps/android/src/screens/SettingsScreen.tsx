import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusPill } from '../components/StatusPill.tsx';
import { theme } from '../components/Theme.ts';
import { useHealth } from '../hooks/use-queries.ts';
import { DeepLinkService } from '../services/deep-link.ts';
import { useAuthStore } from '../state/auth-store.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface SettingsScreenProps {
  onNavigateToArtifacts?: () => void;
  onHandleDeepLink?: (target: ReturnType<typeof DeepLinkService.parseUrl>) => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  onNavigateToArtifacts,
  onHandleDeepLink,
}) => {
  const { user, device, serverUrl, logout } = useAuthStore();
  const { fcmToken, pushNotificationsEnabled, setPushNotificationsEnabled, showToast } =
    useUiStore();
  const { data: health, isLoading: healthLoading } = useHealth();

  const handleTestDeepLink = (path: string) => {
    const target = DeepLinkService.parseUrl(`personal-ai://${path}`);
    if (onHandleDeepLink) {
      onHandleDeepLink(target);
    }
    showToast(`Deep link diproses: personal-ai://${path}`);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Pengaturan & Status Sistem</Text>

      {/* User Session Info */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Akun Pengguna</Text>
        <Text style={styles.infoText}>Email: {user?.email}</Text>
        <Text style={styles.infoTextMuted}>User ID: {user?.id}</Text>
      </View>

      {/* Device Status */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Status Perangkat Klien</Text>
        <View style={styles.row}>
          <Text style={styles.infoLabel}>Platform:</Text>
          <Text style={styles.infoValue}>Android (Expo React Native)</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.infoLabel}>Nama Perangkat:</Text>
          <Text style={styles.infoValue}>{device?.name ?? 'Android Client'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.infoLabel}>Device ID:</Text>
          <Text style={styles.infoValue} numberOfLines={1}>
            {device?.id ?? 'Belum Terdaftar'}
          </Text>
        </View>
      </View>

      {/* Backend & Runtime Status */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Status Runtime VPS & API</Text>
        <View style={styles.row}>
          <Text style={styles.infoLabel}>Server Endpoint:</Text>
          <Text style={styles.infoValue}>{serverUrl}</Text>
        </View>

        {healthLoading ? (
          <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginTop: 8 }} />
        ) : health ? (
          <View style={styles.healthGrid}>
            <View style={styles.healthRow}>
              <Text style={styles.healthLabel}>PostgreSQL + pgvector:</Text>
              <StatusPill status={health.database} />
            </View>
            <View style={styles.healthRow}>
              <Text style={styles.healthLabel}>Redis + BullMQ:</Text>
              <StatusPill status={health.redis} />
            </View>
            <View style={styles.healthRow}>
              <Text style={styles.healthLabel}>API Gateway:</Text>
              <StatusPill status="connected" />
            </View>
          </View>
        ) : (
          <Text style={styles.offlineWarning}>Tidak dapat menghubungi server backend.</Text>
        )}
      </View>

      {/* Notifications & FCM Point */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Notifikasi & FCM</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Aktifkan Push Notifications</Text>
          <Switch
            value={pushNotificationsEnabled}
            onValueChange={setPushNotificationsEnabled}
            trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.primary }}
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Persetujuan Dibutuhkan (Approval)</Text>
          <Switch
            value={useUiStore((s) => s.notifyApprovalRequired)}
            onValueChange={(val) => useUiStore.getState().setNotifyApprovalRequired(val)}
            disabled={!pushNotificationsEnabled}
            trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.primary }}
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Status Tugas Selesai / Gagal</Text>
          <Switch
            value={useUiStore((s) => s.notifyTaskUpdates)}
            onValueChange={(val) => useUiStore.getState().setNotifyTaskUpdates(val)}
            disabled={!pushNotificationsEnabled}
            trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.primary }}
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Blocker / Intervensi Diperlukan</Text>
          <Switch
            value={useUiStore((s) => s.notifyBlockers)}
            onValueChange={(val) => useUiStore.getState().setNotifyBlockers(val)}
            disabled={!pushNotificationsEnabled}
            trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.primary }}
          />
        </View>

        <Text style={styles.infoTextMuted}>
          FCM Token: {fcmToken ? `${fcmToken.slice(0, 16)}...` : 'Siap Terhubung ke Firebase FCM'}
        </Text>
      </View>

      {/* Artifacts Navigator */}
      {onNavigateToArtifacts ? (
        <TouchableOpacity style={styles.actionCard} onPress={onNavigateToArtifacts}>
          <Text style={styles.actionCardTitle}>📁 Buka Manajer Artefak</Text>
          <Text style={styles.actionCardDesc}>Lihat file hasil tugas dan laporan analisis</Text>
        </TouchableOpacity>
      ) : null}

      {/* Deep Link Simulator & Push Testing */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Titik Integrasi Deep Link & Push</Text>
        <Text style={styles.infoTextMuted}>Skema URL: personal-ai://</Text>
        <View style={styles.deepLinkButtons}>
          <TouchableOpacity
            style={styles.deepLinkBtn}
            onPress={() => handleTestDeepLink('approvals/test-appr-123')}
          >
            <Text style={styles.deepLinkBtnText}>Buka Approval</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deepLinkBtn}
            onPress={() => handleTestDeepLink('tasks/test-task-456')}
          >
            <Text style={styles.deepLinkBtnText}>Buka Task</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutButtonText}>Keluar (Logout)</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: theme.spacing.md,
  },
  sectionCard: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: theme.spacing.sm,
  },
  infoText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    marginBottom: 2,
  },
  infoTextMuted: {
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  infoLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  infoValue: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  healthGrid: {
    marginTop: theme.spacing.xs,
  },
  healthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  healthLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  offlineWarning: {
    color: theme.colors.danger,
    fontSize: 12,
    marginTop: 4,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  switchLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
  },
  actionCard: {
    backgroundColor: theme.colors.surfaceElevated,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  actionCardTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  actionCardDesc: {
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  deepLinkButtons: {
    flexDirection: 'row',
    marginTop: theme.spacing.sm,
  },
  deepLinkBtn: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.borderRadius.sm,
    marginRight: theme.spacing.sm,
  },
  deepLinkBtnText: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: theme.colors.dangerBg,
    borderColor: theme.colors.danger,
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  logoutButtonText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
});
