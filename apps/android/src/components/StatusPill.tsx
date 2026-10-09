import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from './Theme.ts';

export interface StatusPillProps {
  status: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ status }) => {
  const getStyles = () => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'connected':
      case 'approved':
        return { color: theme.colors.success, bg: theme.colors.successBg };
      case 'running':
      case 'planning':
      case 'reconnecting':
        return { color: theme.colors.primary, bg: '#1e3a8a' };
      case 'waiting_approval':
      case 'pending':
        return { color: theme.colors.warning, bg: theme.colors.riskMediumBg };
      case 'failed':
      case 'denied':
      case 'cancelled':
      case 'disconnected':
        return { color: theme.colors.danger, bg: theme.colors.dangerBg };
      case 'paused':
      default:
        return { color: theme.colors.textSecondary, bg: theme.colors.surfaceElevated };
    }
  };

  const { color, bg } = getStyles();

  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{status.replace('_', ' ').toUpperCase()}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.borderRadius.full,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
