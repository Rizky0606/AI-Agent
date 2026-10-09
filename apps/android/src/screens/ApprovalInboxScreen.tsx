import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RiskBadge } from '../components/RiskBadge.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { theme } from '../components/Theme.ts';
import { useApprovals, useApproveRequest, useDenyRequest } from '../hooks/use-queries.ts';
import { useUiStore } from '../state/ui-store.ts';

export const ApprovalInboxScreen: React.FC = () => {
  const { approvalStatusFilter, setApprovalStatusFilter, showToast } = useUiStore();
  const { data: approvals, isLoading, refetch } = useApprovals(approvalStatusFilter ?? undefined);

  const approveMutation = useApproveRequest();
  const denyMutation = useDenyRequest();

  const [activeReasonInputId, setActiveReasonInputId] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');

  const handleApprove = async (approvalId: string) => {
    try {
      await approveMutation.mutateAsync({
        approvalId,
        reason: reasonText.trim() || undefined,
      });
      showToast('Aksi berhasil disetujui');
      setActiveReasonInputId(null);
      setReasonText('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyetujui');
    }
  };

  const handleDeny = async (approvalId: string) => {
    try {
      await denyMutation.mutateAsync({
        approvalId,
        reason: reasonText.trim() || undefined,
      });
      showToast('Aksi telah ditolak');
      setActiveReasonInputId(null);
      setReasonText('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menolak');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Kotak Masuk Persetujuan</Text>
        <View style={styles.filterRow}>
          {['pending', 'approved', 'denied'].map((st) => {
            const isSelected = approvalStatusFilter === st;
            return (
              <TouchableOpacity
                key={st}
                style={[styles.filterChip, isSelected && styles.filterChipActive]}
                onPress={() => setApprovalStatusFilter(st)}
              >
                <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                  {st.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
        </View>
      ) : approvals?.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyTitle}>Semua Bersih</Text>
          <Text style={styles.emptySubtitle}>
            Tidak ada permohonan persetujuan yang menunggu saat ini.
          </Text>
        </View>
      ) : (
        <FlatList
          data={approvals}
          keyExtractor={(item) => item.id}
          onRefresh={refetch}
          refreshing={isLoading}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isPending = item.status === 'pending';
            const expiresDate = new Date(item.expiresAt);
            const isExpired = expiresDate.getTime() < Date.now();
            const showReason = activeReasonInputId === item.id;

            return (
              <View style={styles.approvalCard}>
                <View style={styles.cardTopRow}>
                  <RiskBadge level={item.riskLevel} />
                  <StatusPill status={item.status} />
                </View>

                <Text style={styles.actionTitle}>{item.action}</Text>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Target / Resource:</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>
                    {item.resource}
                  </Text>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Scope Lingkup:</Text>
                  <Text style={styles.infoValue}>{item.scope}</Text>
                </View>

                <View style={styles.consequenceBox}>
                  <Text style={styles.consequenceHeading}>Konsekuensi Aksi:</Text>
                  <Text style={styles.consequenceText}>{item.consequence}</Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>
                    Batas Waktu:{' '}
                    {isExpired
                      ? 'Sudah Kedaluwarsa'
                      : expiresDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>

                {isPending && !isExpired ? (
                  <View style={styles.actionContainer}>
                    {showReason ? (
                      <TextInput
                        style={styles.reasonInput}
                        placeholder="Catatan / alasan (opsional)..."
                        placeholderTextColor={theme.colors.textMuted}
                        value={reasonText}
                        onChangeText={setReasonText}
                      />
                    ) : (
                      <TouchableOpacity
                        style={styles.toggleReasonBtn}
                        onPress={() => setActiveReasonInputId(item.id)}
                      >
                        <Text style={styles.toggleReasonText}>+ Tambah catatan / alasan</Text>
                      </TouchableOpacity>
                    )}

                    <View style={styles.buttonsRow}>
                      <TouchableOpacity
                        style={[styles.btn, styles.denyBtn]}
                        disabled={denyMutation.isPending}
                        onPress={() => handleDeny(item.id)}
                      >
                        <Text style={styles.btnText}>Tolak (Deny)</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.approveBtn]}
                        disabled={approveMutation.isPending}
                        onPress={() => handleApprove(item.id)}
                      >
                        <Text style={styles.btnText}>Setujui (Approve)</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceBorder,
  },
  headerTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: theme.spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceElevated,
    marginRight: theme.spacing.xs,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
  },
  filterChipText: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  emptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  emptySubtitle: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  listContent: {
    padding: theme.spacing.md,
  },
  approvalCard: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    marginBottom: theme.spacing.md,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  actionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: theme.spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  infoLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    width: 120,
  },
  infoValue: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  consequenceBox: {
    backgroundColor: theme.colors.surfaceElevated,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  consequenceHeading: {
    color: theme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  consequenceText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  metaRow: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  metaText: {
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  actionContainer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.surfaceBorder,
    paddingTop: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  toggleReasonBtn: {
    marginBottom: theme.spacing.sm,
  },
  toggleReasonText: {
    color: theme.colors.primary,
    fontSize: 12,
  },
  reasonInput: {
    backgroundColor: theme.colors.surfaceElevated,
    color: theme.colors.textPrimary,
    padding: 8,
    borderRadius: theme.borderRadius.sm,
    fontSize: 12,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  denyBtn: {
    backgroundColor: theme.colors.dangerBg,
    borderWidth: 1,
    borderColor: theme.colors.danger,
  },
  approveBtn: {
    backgroundColor: theme.colors.success,
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
