import React from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from './Theme.ts';

export interface ProgressBarProps {
  progress: number; // 0 to 100
  color?: string | undefined;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  color = theme.colors.primary,
}) => {
  const clamped = Math.max(0, Math.min(100, progress));

  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    height: 6,
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.borderRadius.full,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    height: '100%',
    borderRadius: theme.borderRadius.full,
  },
});
