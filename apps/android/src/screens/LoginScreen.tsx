import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { theme } from '../components/Theme.ts';
import { useAuthStore } from '../state/auth-store.ts';

export const LoginScreen: React.FC = () => {
  const { login, register, serverUrl, setServerUrl, isLoading, error, clearError } = useAuthStore();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [showServerConfig, setShowServerConfig] = useState(false);

  const handleSubmit = async () => {
    clearError();
    if (urlInput !== serverUrl) {
      await setServerUrl(urlInput);
    }
    if (isRegisterMode) {
      await register(email, password);
    } else {
      await login(email, password);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Personal AI OS</Text>
        <Text style={styles.subtitle}>
          {isRegisterMode ? 'Daftar akun baru asisten AI' : 'Masuk ke kontrol pusat asisten AI'}
        </Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={() => setShowServerConfig(!showServerConfig)}
          style={styles.serverToggle}
        >
          <Text style={styles.serverToggleText}>
            ⚙️ Server: {serverUrl} {showServerConfig ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {showServerConfig ? (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              style={styles.input}
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder="http://10.0.2.2:3000"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ) : null}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="user@example.com"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Minimal 12 karakter"
            placeholderTextColor={theme.colors.textMuted}
            secureTextEntry
          />
        </View>

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{isRegisterMode ? 'Daftar' : 'Masuk'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toggleModeBtn}
          onPress={() => {
            clearError();
            setIsRegisterMode(!isRegisterMode);
          }}
        >
          <Text style={styles.toggleModeText}>
            {isRegisterMode
              ? 'Sudah punya akun? Masuk di sini'
              : 'Belum punya akun? Daftar sekarang'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  card: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },
  errorBox: {
    backgroundColor: theme.colors.dangerBg,
    borderColor: theme.colors.danger,
    borderWidth: 1,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 13,
  },
  serverToggle: {
    paddingVertical: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  serverToggleText: {
    color: theme.colors.primary,
    fontSize: 12,
  },
  inputGroup: {
    marginBottom: theme.spacing.md,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  input: {
    backgroundColor: theme.colors.surfaceElevated,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
    fontSize: 14,
  },
  button: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  toggleModeBtn: {
    marginTop: theme.spacing.lg,
    alignItems: 'center',
  },
  toggleModeText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
  },
});
