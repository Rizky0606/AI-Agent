import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, ShieldAlert } from 'lucide-react-native';
import type { ApprovalRequest } from '../api/types.ts';
import { idID } from '../locales/id-ID.ts';
import { RiskBadge } from './RiskBadge.tsx';
import { StatusPill } from './StatusPill.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';

export interface ApprovalCardProps {
  approval: ApprovalRequest;
  onPress: (approval: ApprovalRequest) => void;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ approval, onPress }) => {
  const theme = useAppTheme();
  const isPending = approval.status === 'pending';
  const isCritical = approval.riskLevel === 'CRITICAL';
  const isHigh = approval.riskLevel === 'HIGH';
  const isHighRisk = isCritical || isHigh;

  const cardBorderColor = isPending
    ? isCritical
      ? theme.colors.riskCritical
      : isHigh
        ? theme.colors.riskHigh
        : theme.colors.surfaceBorder
    : theme.colors.surfaceBorder;

  const cardBgColor = isPending
    ? isCritical
      ? theme.colors.riskCriticalBg
      : isHigh
        ? theme.colors.riskHighBg
        : theme.colors.surface
    : theme.colors.surface;

  const rippleColor =
    theme.scheme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${idID.approval.cardTitle} ${approval.action}, level ${approval.riskLevel}, status ${approval.status}`}
      accessibilityHint="Buka lembar persetujuan untuk menyetujui atau menolak"
      android_ripple={{ color: rippleColor }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: cardBgColor,
          borderColor: cardBorderColor,
        },
        pressed && Platform.OS !== 'android' ? styles.cardPressed : null,
      ]}
      onPress={() => onPress(approval)}
    >
      {/* Top row: Risk badge & status */}
      <View style={styles.topRow}>
        <View style={styles.riskBadgeContainer}>
          <RiskBadge level={approval.riskLevel} />
          {isHighRisk ? (
            <ShieldAlert
              size={16}
              color={isCritical ? theme.colors.riskCritical : theme.colors.riskHigh}
              style={{ marginLeft: 6 }}
            />
          ) : null}
        </View>
        <StatusPill status={approval.status} />
      </View>

      {/* Action title */}
      <Text
        style={[styles.actionText, { color: theme.colors.textPrimary }]}
        numberOfLines={1}
        allowFontScaling
      >
        {approval.action}
      </Text>

      {/* Resource snippet */}
      <Text
        style={[styles.resourceText, { color: theme.colors.textSecondary }]}
        numberOfLines={1}
        allowFontScaling
      >
        {approval.resource}
      </Text>

      {/* Consequence text */}
      <Text
        style={[
          styles.consequenceText,
          {
            color: isCritical
              ? theme.colors.riskCritical
              : isHigh
                ? theme.colors.riskHigh
                : theme.colors.textMuted,
          },
        ]}
        numberOfLines={2}
        allowFontScaling
      >
        {approval.consequence}
      </Text>

      {/* Bottom action row: 48dp minimum touch target */}
      <View
        style={[
          styles.footerRow,
          { borderTopColor: theme.colors.surfaceBorder },
        ]}
      >
        <Text
          style={[
            styles.footerPrompt,
            { color: isPending ? theme.colors.primary : theme.colors.textMuted },
          ]}
          allowFontScaling
        >
          {isPending ? idID.approval.detailTitle : idID.common.details}
        </Text>
        <ChevronRight size={18} color={theme.colors.primary} />
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    elevation: 2,
  },
  cardPressed: {
    opacity: 0.8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  riskBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionText: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  resourceText: {
    fontSize: 13,
    marginBottom: 6,
  },
  consequenceText: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    minHeight: 48,
  },
  footerPrompt: {
    fontSize: 13,
    fontWeight: '700',
  },
});
