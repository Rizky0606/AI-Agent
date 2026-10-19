import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AlertTriangle, Check, ShieldAlert, X } from 'lucide-react-native';
import type { ApprovalRequest } from '../api/types.ts';
import { idID } from '../locales/id-ID.ts';
import { RiskBadge } from './RiskBadge.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';

export interface ApprovalBottomSheetProps {
  visible: boolean;
  approval: ApprovalRequest | null;
  isLoading?: boolean;
  onClose: () => void;
  onApprove: (approvalId: string, reason?: string) => Promise<void>;
  onDeny: (approvalId: string, reason?: string) => Promise<void>;
}

export const ApprovalBottomSheet: React.FC<ApprovalBottomSheetProps> = ({
  visible,
  approval,
  isLoading = false,
  onClose,
  onApprove,
  onDeny,
}) => {
  const theme = useAppTheme();
  const [reason, setReason] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  if (!approval) return null;

  const isPending = approval.status === 'pending';
  const isCritical = approval.riskLevel === 'CRITICAL';
  const isHigh = approval.riskLevel === 'HIGH';
  const isHighRisk = isCritical || isHigh;
  const riskColor = isCritical ? theme.colors.riskCritical : isHigh ? theme.colors.riskHigh : theme.colors.textPrimary;
  const riskBgColor = isCritical
    ? theme.colors.riskCriticalBg
    : isHigh
      ? theme.colors.riskHighBg
      : theme.colors.surfaceElevated;

  const handleApprovePress = () => {
    if (isHighRisk) {
      setShowConfirmModal(true);
    } else {
      void onApprove(approval.id, reason.trim() || undefined);
    }
  };

  const handleConfirmSecondaryApprove = async () => {
    setShowConfirmModal(false);
    await onApprove(approval.id, reason.trim() || undefined);
  };

  const handleDenyPress = async () => {
    await onDeny(approval.id, reason.trim() || undefined);
  };

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <View style={styles.backdrop}>
          <TouchableOpacity
            style={styles.backdropTouch}
            activeOpacity={1}
            onPress={onClose}
            accessibilityLabel={idID.common.close}
            accessibilityRole="button"
          />
          <View
            style={[
              styles.sheetContainer,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            {/* Header */}
            <View
              style={[
                styles.sheetHeader,
                { borderBottomColor: theme.colors.surfaceBorder },
              ]}
            >
              <View style={styles.sheetHeaderLeft}>
                <ShieldAlert size={20} color={theme.colors.primary} />
                <Text
                  style={[styles.sheetTitle, { color: theme.colors.textPrimary }]}
                  accessibilityRole="header"
                >
                  {idID.approval.detailTitle}
                </Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={idID.common.close}
                style={styles.closeButton}
                onPress={onClose}
              >
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              {/* Risk Level Badge Row */}
              <View style={styles.detailRow}>
                <Text style={[styles.fieldLabel, { color: theme.colors.textMuted }]}>
                  {idID.approval.riskLevelLabel}
                </Text>
                <View style={styles.riskRow}>
                  <RiskBadge level={approval.riskLevel} />
                  <Text
                    style={[
                      styles.riskDescText,
                      {
                        color:
                          approval.riskLevel === 'CRITICAL'
                            ? theme.colors.riskCritical
                            : approval.riskLevel === 'HIGH'
                              ? theme.colors.riskHigh
                              : approval.riskLevel === 'MEDIUM'
                                ? theme.colors.riskMedium
                                : theme.colors.riskLow,
                      },
                    ]}
                  >
                    {approval.riskLevel === 'CRITICAL'
                      ? idID.approval.riskCritical
                      : approval.riskLevel === 'HIGH'
                        ? idID.approval.riskHigh
                        : approval.riskLevel === 'MEDIUM'
                          ? idID.approval.riskMedium
                          : idID.approval.riskLow}
                  </Text>
                </View>
              </View>

              {/* Action */}
              <View style={styles.detailSection}>
                <Text style={[styles.fieldLabel, { color: theme.colors.textMuted }]}>
                  {idID.approval.actionLabel}
                </Text>
                <View
                  style={[
                    styles.codeBox,
                    {
                      backgroundColor: theme.colors.surfaceElevated,
                      borderColor: theme.colors.surfaceBorder,
                    },
                  ]}
                >
                  <Text
                    selectable
                    style={[
                      styles.codeBoxText,
                      { color: theme.colors.textPrimary },
                    ]}
                  >
                    {approval.action}
                  </Text>
                </View>
              </View>

              {/* Target Resource */}
              <View style={styles.detailSection}>
                <Text style={[styles.fieldLabel, { color: theme.colors.textMuted }]}>
                  {idID.approval.resourceLabel}
                </Text>
                <View
                  style={[
                    styles.codeBox,
                    {
                      backgroundColor: theme.colors.surfaceElevated,
                      borderColor: theme.colors.surfaceBorder,
                    },
                  ]}
                >
                  <Text
                    selectable
                    style={[
                      styles.codeBoxText,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    {approval.resource}
                  </Text>
                </View>
              </View>

              {/* Consequence */}
              <View style={styles.detailSection}>
                <Text style={[styles.fieldLabel, { color: theme.colors.textMuted }]}>
                  {idID.approval.consequencesLabel}
                </Text>
                <View
                  style={[
                    styles.consequenceBox,
                    {
                      backgroundColor: isHighRisk ? riskBgColor : theme.colors.surfaceElevated,
                      borderColor: isHighRisk ? riskColor : theme.colors.surfaceBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.consequenceText,
                      {
                        color: isHighRisk ? riskColor : theme.colors.textPrimary,
                      },
                    ]}
                    allowFontScaling
                  >
                    {approval.consequence}
                  </Text>
                </View>
              </View>

              {/* Decision reason input if pending */}
              {isPending ? (
                <View style={styles.detailSection}>
                  <Text style={[styles.fieldLabel, { color: theme.colors.textMuted }]}>
                    {idID.approval.reasonOptional}
                  </Text>
                  <TextInput
                    style={[
                      styles.reasonInput,
                      {
                        backgroundColor: theme.colors.surfaceElevated,
                        borderColor: theme.colors.surfaceBorder,
                        color: theme.colors.textPrimary,
                      },
                    ]}
                    placeholder={idID.approval.reasonOptional}
                    placeholderTextColor={theme.colors.textMuted}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    maxLength={500}
                    accessibilityLabel={idID.approval.reasonOptional}
                  />
                </View>
              ) : null}

              {/* Action Buttons */}
              {isPending ? (
                <View style={styles.actionButtonsContainer}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={idID.approval.approveButton}
                    disabled={isLoading}
                    style={[
                      styles.actionButton,
                      styles.approveButton,
                      { backgroundColor: theme.colors.success },
                      isLoading && styles.buttonDisabled,
                    ]}
                    onPress={handleApprovePress}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Check size={18} color="#fff" />
                        <Text style={styles.approveButtonText}>
                          {idID.approval.approveButton}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={idID.approval.denyButton}
                    disabled={isLoading}
                    style={[
                      styles.actionButton,
                      styles.denyButton,
                      {
                        backgroundColor: theme.colors.dangerBg,
                        borderColor: theme.colors.danger,
                      },
                      isLoading && styles.buttonDisabled,
                    ]}
                    onPress={() => void handleDenyPress()}
                  >
                    <X size={18} color={theme.colors.danger} />
                    <Text
                      style={[
                        styles.denyButtonText,
                        { color: theme.colors.danger },
                      ]}
                    >
                      {idID.approval.denyButton}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.statusResolvedBox}>
                  <Text style={[styles.statusResolvedText, { color: theme.colors.textMuted }]}>
                    Status: {approval.status.toUpperCase()}
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Secondary Confirmation Modal for HIGH / CRITICAL */}
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={styles.confirmBackdrop}>
          <View
            style={[
              styles.confirmCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: riskColor,
              },
            ]}
          >
            <View style={styles.confirmHeader}>
              <AlertTriangle size={28} color={riskColor} />
              <Text
                style={[styles.confirmTitle, { color: theme.colors.textPrimary }]}
                allowFontScaling
              >
                {idID.approval.secondaryConfirmTitle}
              </Text>
            </View>

            <Text
              style={[styles.confirmDesc, { color: theme.colors.textSecondary }]}
              allowFontScaling
            >
              {idID.approval.secondaryConfirmDesc}
            </Text>

            <View
              style={[
                styles.confirmConsequenceBox,
                {
                  backgroundColor: riskBgColor,
                  borderColor: riskColor,
                },
              ]}
            >
              <Text
                style={[styles.confirmConsequenceText, { color: riskColor }]}
                allowFontScaling
              >
                {approval.consequence}
              </Text>
            </View>

            <View style={styles.confirmButtons}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={idID.approval.confirmProceed}
                style={[
                  styles.confirmProceedBtn,
                  { backgroundColor: riskColor },
                ]}
                onPress={() => void handleConfirmSecondaryApprove()}
              >
                <Text style={styles.confirmProceedText} allowFontScaling>
                  {idID.approval.confirmProceed}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={idID.approval.confirmCancel}
                style={[
                  styles.confirmCancelBtn,
                  {
                    borderColor: theme.colors.surfaceBorder,
                    backgroundColor: theme.colors.surfaceElevated,
                  },
                ]}
                onPress={() => setShowConfirmModal(false)}
              >
                <Text
                  style={[
                    styles.confirmCancelText,
                    { color: theme.colors.textPrimary },
                  ]}
                >
                  {idID.approval.confirmCancel}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  backdropTouch: {
    flex: 1,
  },
  sheetContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    maxHeight: '85%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    minHeight: 56,
  },
  sheetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetBody: {
    padding: 16,
    paddingBottom: 32,
  },
  detailRow: {
    marginBottom: 12,
  },
  riskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  riskDescText: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailSection: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  codeBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  codeBoxText: {
    fontSize: 13,
    fontFamily: 'monospace',
  },
  consequenceBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  consequenceText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  reasonInput: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    minHeight: 60,
    textAlignVertical: 'top',
    fontSize: 13,
  },
  actionButtonsContainer: {
    marginTop: 16,
    gap: 12,
  },
  actionButton: {
    minHeight: 48,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  approveButton: {},
  approveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  denyButton: {
    borderWidth: 1,
  },
  denyButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  statusResolvedBox: {
    marginTop: 16,
    alignItems: 'center',
    padding: 12,
  },
  statusResolvedText: {
    fontSize: 13,
    fontWeight: '600',
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 20,
    elevation: 8,
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '800',
    flex: 1,
  },
  confirmDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  confirmConsequenceBox: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 20,
  },
  confirmConsequenceText: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  confirmButtons: {
    gap: 10,
  },
  confirmProceedBtn: {
    minHeight: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  confirmProceedText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  confirmCancelBtn: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  confirmCancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
