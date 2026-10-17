import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RiskBadge } from '../components/RiskBadge.tsx';
import { ScreenHeader } from '../components/ScreenHeader.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useApprovals, useApproveRequest, useDenyRequest } from '../hooks/use-queries.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface ApprovalInboxScreenProps {
  onBack?: () => void;
}

export const ApprovalInboxScreen: React.FC<ApprovalInboxScreenProps> = ({ onBack }) => {
  const theme = useAppTheme();
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
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {onBack ? (
        <ScreenHeader title="Kotak Masuk Persetujuan" onBack={onBack} />
      ) : (
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.colors.surface,
              borderBottomColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]} allowFontScaling>
            Kotak Masuk Persetujuan
          </Text>
        </View>
      )}

      {/* Filter Row */}
      <View
        style={[
          styles.filterRow,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        {['pending', 'approved', 'denied'].map((st) => {
          const isSelected = approvalStatusFilter === st;
          return (
            <Pressable
              key={st}
              android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
              style={[
                styles.filterChip,
                {
                  backgroundColor: isSelected
                    ? theme.colors.primary
                    : theme.colors.surfaceElevated,
                  borderColor: isSelected ? theme.colors.primary : theme.colors.surfaceBorder,
                },
              ]}
              onPress={() => setApprovalStatusFilter(st)}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${st}`}
            >
              <Text
                style={[
                  styles.filterChipText,
                  {
                    color: isSelected ? '#fff' : theme.colors.textSecondary,
                    fontWeight: isSelected ? '700' : '600',
                  },
                ]}
                allowFontScaling
              >
                {st.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
        </View>
      ) : approvals?.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]} allowFontScaling>
            Semua Bersih
          </Text>
          <Text
            style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}
            allowFontScaling
          >
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
              <View
                style={[
                  styles.approvalCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor:
                      item.riskLevel === 'CRITICAL'
                        ? theme.colors.riskCritical
                        : item.riskLevel === 'HIGH'
                          ? theme.colors.riskHigh
                          : theme.colors.surfaceBorder,
                  },
                ]}
              >
                <View style={styles.cardTopRow}>
                  <RiskBadge level={item.riskLevel} />
                  <StatusPill status={item.status} />
                </View>

                <Text
                  style={[styles.actionTitle, { color: theme.colors.textPrimary }]}
                  allowFontScaling
                >
                  {item.action}
                </Text>

                <View style={styles.infoRow}>
                  <Text
                    style={[styles.infoLabel, { color: theme.colors.textMuted }]}
                    allowFontScaling
                  >
                    Target / Resource:
                  </Text>
                  <Text
                    style={[styles.infoValue, { color: theme.colors.textSecondary }]}
                    numberOfLines={1}
                    allowFontScaling
                  >
                    {item.resource}
                  </Text>
                </View>

                <View style={styles.infoRow}>
                  <Text
                    style={[styles.infoLabel, { color: theme.colors.textMuted }]}
                    allowFontScaling
                  >
                    Scope Lingkup:
                  </Text>
                  <Text
                    style={[styles.infoValue, { color: theme.colors.textSecondary }]}
                    allowFontScaling
                  >
                    {item.scope}
                  </Text>
                </View>

                <View
                  style={[
                    styles.consequenceBox,
                    {
                      backgroundColor:
                        item.riskLevel === 'CRITICAL'
                          ? theme.colors.riskCriticalBg
                          : item.riskLevel === 'HIGH'
                            ? theme.colors.riskHighBg
                            : theme.colors.surfaceElevated,
                      borderColor:
                        item.riskLevel === 'CRITICAL'
                          ? theme.colors.riskCritical
                          : item.riskLevel === 'HIGH'
                            ? theme.colors.riskHigh
                            : theme.colors.surfaceBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.consequenceHeading,
                      {
                        color:
                          item.riskLevel === 'CRITICAL'
                            ? theme.colors.riskCritical
                            : item.riskLevel === 'HIGH'
                              ? theme.colors.riskHigh
                              : theme.colors.textPrimary,
                      },
                    ]}
                    allowFontScaling
                  >
                    Konsekuensi Aksi:
                  </Text>
                  <Text
                    style={[styles.consequenceText, { color: theme.colors.textPrimary }]}
                    allowFontScaling
                  >
                    {item.consequence}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <Text
                    style={[styles.metaText, { color: theme.colors.textMuted }]}
                    allowFontScaling
                  >
                    Batas Waktu:{' '}
                    {isExpired
                      ? 'Sudah Kedaluwarsa'
                      : expiresDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>

                {isPending && !isExpired ? (
                  <View
                    style={[
                      styles.actionContainer,
                      { borderTopColor: theme.colors.surfaceBorder },
                    ]}
                  >
                    {showReason ? (
                      <TextInput
                        style={[
                          styles.reasonInput,
                          {
                            backgroundColor: theme.colors.surfaceElevated,
                            color: theme.colors.textPrimary,
                            borderColor: theme.colors.surfaceBorder,
                          },
                        ]}
                        placeholder="Catatan / alasan (opsional)..."
                        placeholderTextColor={theme.colors.textMuted}
                        value={reasonText}
                        onChangeText={setReasonText}
                        accessibilityLabel="Catatan alasan persetujuan"
                      />
                    ) : (
                      <TouchableOpacity
                        style={styles.toggleReasonBtn}
                        onPress={() => setActiveReasonInputId(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel="Tambah catatan alasan"
                      >
                        <Text
                          style={[styles.toggleReasonText, { color: theme.colors.primary }]}
                          allowFontScaling
                        >
                          + Tambah catatan / alasan
                        </Text>
                      </TouchableOpacity>
                    )}

                    <View style={styles.buttonsRow}>
                      <Pressable
                        android_ripple={{ color: 'rgba(239, 68, 68, 0.2)' }}
                        style={[
                          styles.btn,
                          {
                            backgroundColor: theme.colors.dangerBg,
                            borderColor: theme.colors.danger,
                          },
                        ]}
                        disabled={denyMutation.isPending}
                        onPress={() => handleDeny(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel="Tolak permintaan persetujuan"
                      >
                        <Text
                          style={[styles.btnText, { color: theme.colors.danger }]}
                          allowFontScaling
                        >
                          Tolak (Deny)
                        </Text>
                      </Pressable>
                      <Pressable
                        android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
                        style={[
                          styles.btn,
                          {
                            backgroundColor:
                              item.riskLevel === 'CRITICAL'
                                ? theme.colors.riskCritical
                                : theme.colors.success,
                          },
                        ]}
                        disabled={approveMutation.isPending}
                        onPress={() => handleApprove(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel="Setujui permintaan persetujuan"
                      >
                        <Text style={[styles.btnText, { color: '#fff' }]} allowFontScaling>
                          Setujui (Approve)
                        </Text>
                      </Pressable>
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
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  filterChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipText: {
    fontSize: 11,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
  },
  approvalCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  infoLabel: {
    fontSize: 12,
    width: 120,
  },
  infoValue: {
    fontSize: 12,
    flex: 1,
  },
  consequenceBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    marginBottom: 6,
  },
  consequenceHeading: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  consequenceText: {
    fontSize: 12,
    lineHeight: 16,
  },
  metaRow: {
    marginTop: 4,
    marginBottom: 8,
  },
  metaText: {
    fontSize: 11,
  },
  actionContainer: {
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 6,
  },
  toggleReasonBtn: {
    marginBottom: 10,
    minHeight: 40,
    justifyContent: 'center',
  },
  toggleReasonText: {
    fontSize: 12,
  },
  reasonInput: {
    padding: 10,
    borderRadius: 8,
    fontSize: 12,
    marginBottom: 10,
    borderWidth: 1,
    minHeight: 44,
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  btn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  btnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
