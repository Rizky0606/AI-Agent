import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { defaultApiClient } from '../api/client.ts';
import type { ModelCatalogResponse } from '../api/types.ts';
import { StatusPill } from '../components/StatusPill.tsx';
import { theme } from '../components/Theme.ts';
import { useHealth } from '../hooks/use-queries.ts';
import { defaultFcmService } from '../services/fcm-service.ts';
import { useAuthStore } from '../state/auth-store.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface SettingsScreenProps {
  onNavigateToArtifacts?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onNavigateToArtifacts }) => {
  const { user, device, serverUrl, logout } = useAuthStore();
  const { fcmToken, pushNotificationsEnabled, setPushNotificationsEnabled } = useUiStore();
  const { data: health, isLoading: healthLoading } = useHealth();
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const fcmStatus = defaultFcmService.getStatus();
  const loadCatalog = async () => {
    try { setCatalogError(null); setCatalog(await defaultApiClient.listModels()); } catch (error) { setCatalogError(error instanceof Error ? error.message : 'Model catalog unavailable'); }
  };
  useEffect(() => { void loadCatalog(); }, []);

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
              <StatusPill status={health.status === 'ready' ? 'connected' : 'disconnected'} />
            </View>
          </View>
        ) : (
          <Text style={styles.offlineWarning}>Tidak dapat menghubungi server backend.</Text>
        )}
      </View>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Model Catalog</Text>
        <Text style={styles.infoTextMuted}>{catalog ? `Source: ${catalog.source}` : 'Loading model catalog...'}</Text>
        {catalogError ? <Text style={styles.offlineWarning}>{catalogError}</Text> : null}
        {catalog?.models.map((model) => <Text key={model.id} style={styles.infoText}>{model.id} · {model.capabilities.join(', ')}</Text>)}
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() =>
            void defaultApiClient
              .refreshModels()
              .then(setCatalog)
              .catch((error) => setCatalogError(error instanceof Error ? error.message : 'Refresh failed'))
          }
        >
          <Text style={styles.refreshBtnText}>Muat ulang model</Text>
        </TouchableOpacity>
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

        <View style={styles.row}>
          <Text style={styles.infoLabel}>Status Kredensial:</Text>
          <Text
            style={[
              styles.infoValue,
              { color: fcmStatus.isConfigured ? theme.colors.success : theme.colors.warning },
            ]}
          >
            {fcmStatus.isConfigured ? 'Aktif' : 'Belum Aktif (Non-aktif)'}
          </Text>
        </View>
        <Text style={styles.infoTextMuted}>{fcmStatus.reason}</Text>
        <Text style={styles.infoTextMuted}>
          FCM Token: {fcmToken ? `${fcmToken.slice(0, 16)}...` : 'Belum ada token'}
        </Text>
      </View>

      {/* Artifacts Navigator */}
      {onNavigateToArtifacts ? (
        <TouchableOpacity style={styles.actionCard} onPress={onNavigateToArtifacts}>
          <Text style={styles.actionCardTitle}>📁 Buka Manajer Artefak</Text>
          <Text style={styles.actionCardDesc}>Lihat file hasil tugas dan laporan analisis</Text>
        </TouchableOpacity>
      ) : null}

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
  refreshBtn: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.borderRadius.sm,
    alignSelf: 'flex-start',
  },
  refreshBtnText: {
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
