import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RiskLevel } from '../api/types.ts';
import { theme } from './Theme.ts';

export interface RiskBadgeProps {
  level: RiskLevel;
}

export const RiskBadge: React.FC<RiskBadgeProps> = ({ level }) => {
  const getColors = () => {
    switch (level) {
      case 'LOW':
        return { text: theme.colors.riskLow, bg: theme.colors.riskLowBg };
      case 'MEDIUM':
        return { text: theme.colors.riskMedium, bg: theme.colors.riskMediumBg };
      case 'HIGH':
        return { text: theme.colors.riskHigh, bg: theme.colors.riskHighBg };
      case 'CRITICAL':
        return { text: theme.colors.riskCritical, bg: theme.colors.riskCriticalBg };
      default:
        return { text: theme.colors.textSecondary, bg: theme.colors.surfaceElevated };
    }
  };

  const { text, bg } = getColors();

  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: text }]}>
      <Text style={[styles.label, { color: text }]}>{level}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
