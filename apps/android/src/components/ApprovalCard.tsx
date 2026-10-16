import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  const isHighRisk = approval.riskLevel === 'HIGH' || approval.riskLevel === 'CRITICAL';

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${idID.approval.cardTitle} ${approval.action}, level ${approval.riskLevel}, status ${approval.status}`}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: isPending && isHighRisk ? theme.colors.riskHigh : theme.colors.surfaceBorder,
        },
      ]}
      onPress={() => onPress(approval)}
      activeOpacity={0.7}
    >
      {/* Top row: Risk badge & status */}
      <View style={styles.topRow}>
        <View style={styles.riskBadgeContainer}>
          <RiskBadge level={approval.riskLevel} />
          {isHighRisk ? (
            <ShieldAlert size={16} color={theme.colors.riskHigh} style={{ marginLeft: 6 }} />
          ) : null}
        </View>
        <StatusPill status={approval.status} />
      </View>

      {/* Action title */}
      <Text
        style={[styles.actionText, { color: theme.colors.textPrimary }]}
        numberOfLines={1}
      >
        {approval.action}
      </Text>

      {/* Resource snippet */}
      <Text
        style={[styles.resourceText, { color: theme.colors.textSecondary }]}
        numberOfLines={1}
      >
        {approval.resource}
      </Text>

      {/* Consequence text */}
      <Text
        style={[
          styles.consequenceText,
          {
            color: isHighRisk ? theme.colors.riskHigh : theme.colors.textMuted,
          },
        ]}
        numberOfLines={2}
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
        >
          {isPending ? idID.approval.detailTitle : idID.common.details}
        </Text>
        <ChevronRight size={18} color={theme.colors.primary} />
      </View>
    </TouchableOpacity>
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
