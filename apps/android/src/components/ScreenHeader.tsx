import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useAppTheme } from '../hooks/use-theme.ts';
import { idID } from '../locales/id-ID.ts';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
  rightElement?: React.ReactNode | undefined;
  backAccessibilityLabel?: string | undefined;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  subtitle,
  onBack,
  rightElement,
  backAccessibilityLabel,
}) => {
  const theme = useAppTheme();

  const rippleColor =
    theme.scheme === 'dark'
      ? 'rgba(255, 255, 255, 0.12)'
      : 'rgba(0, 0, 0, 0.08)';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <View style={styles.leftRow}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backAccessibilityLabel ?? idID.common.back}
            accessibilityHint="Kembali ke layar sebelumnya"
            android_ripple={{ color: rippleColor, borderless: true, radius: 24 }}
            style={({ pressed }) => [
              styles.backButton,
              pressed && Platform.OS !== 'android' ? styles.pressedButton : null,
            ]}
            onPress={onBack}
          >
            <ArrowLeft size={22} color={theme.colors.textPrimary} />
          </Pressable>
        ) : null}

        <View style={styles.titleContainer}>
          <Text
            style={[styles.title, { color: theme.colors.textPrimary }]}
            numberOfLines={1}
            allowFontScaling
            accessibilityRole="header"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.subtitle, { color: theme.colors.textSecondary }]}
              numberOfLines={1}
              allowFontScaling
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {rightElement ? <View style={styles.rightContainer}>{rightElement}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    elevation: 2,
  },
  leftRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    borderRadius: 24,
  },
  pressedButton: {
    opacity: 0.7,
  },
  titleContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
});
