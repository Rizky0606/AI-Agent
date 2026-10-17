import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronDown, ChevronUp, Globe, LogIn, Sparkles } from 'lucide-react-native';
import { useAppTheme } from '../hooks/use-theme.ts';
import { idID } from '../locales/id-ID.ts';
import { useAuthStore } from '../state/auth-store.ts';

export const LoginScreen: React.FC = () => {
  const theme = useAppTheme();
  const {
    login,
    register,
    loginWithGoogle,
    serverUrl,
    setServerUrl,
    isLoading,
    error,
    clearError,
  } = useAuthStore();

  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [showEmailAuth, setShowEmailAuth] = useState(false);
  const [showAdvancedServer, setShowAdvancedServer] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [urlInput, setUrlInput] = useState(serverUrl);

  const handleGoogleLogin = async () => {
    clearError();
    if (urlInput !== serverUrl) {
      await setServerUrl(urlInput);
    }
    await loginWithGoogle();
  };

  const handleEmailSubmit = async () => {
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
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          {/* Hero Branding */}
          <View style={styles.brandContainer}>
            <View
              style={[
                styles.iconBadge,
                { backgroundColor: theme.colors.surfaceElevated },
              ]}
            >
              <Sparkles size={32} color={theme.colors.primary} />
            </View>
            <Text
              style={[styles.title, { color: theme.colors.textPrimary }]}
              accessibilityRole="header"
              allowFontScaling
            >
              {idID.auth.appTitle}
            </Text>
            <Text
              style={[styles.subtitle, { color: theme.colors.textSecondary }]}
              allowFontScaling
            >
              {idID.auth.appSubtitle}
            </Text>
          </View>

          {/* Error Banner */}
          {error ? (
            <View
              style={[
                styles.errorBox,
                {
                  backgroundColor: theme.colors.dangerBg,
                  borderColor: theme.colors.danger,
                },
              ]}
            >
              <Text
                style={[styles.errorText, { color: theme.colors.danger }]}
                allowFontScaling
              >
                {error}
              </Text>
            </View>
          ) : null}

          {/* Primary Action: Google Login */}
          <Pressable
            android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
            accessibilityRole="button"
            accessibilityLabel={idID.auth.loginGoogle}
            disabled={isLoading}
            style={[
              styles.googleButton,
              {
                backgroundColor: theme.colors.primary,
                borderColor: theme.colors.primary,
              },
              isLoading && styles.buttonDisabled,
            ]}
            onPress={handleGoogleLogin}
          >
            {isLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.googleButtonText} allowFontScaling>
                  Menghubungkan ke sesi Anda...
                </Text>
              </View>
            ) : (
              <>
                <LogIn size={20} color="#fff" />
                <Text style={styles.googleButtonText} allowFontScaling>
                  {idID.auth.loginGoogle}
                </Text>
              </>
            )}
          </Pressable>

          {/* Secondary Collapsible: Email & Password */}
          <View style={styles.accordionSection}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.auth.otherOptions}
              style={[
                styles.accordionToggle,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                },
              ]}
              onPress={() => setShowEmailAuth(!showEmailAuth)}
            >
              <Text
                style={[styles.accordionToggleText, { color: theme.colors.textPrimary }]}
              >
                {idID.auth.otherOptions}
              </Text>
              {showEmailAuth ? (
                <ChevronUp size={18} color={theme.colors.textSecondary} />
              ) : (
                <ChevronDown size={18} color={theme.colors.textSecondary} />
              )}
            </TouchableOpacity>

            {showEmailAuth ? (
              <View
                style={[
                  styles.emailFormBox,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.surfaceBorder,
                  },
                ]}
              >
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                    {idID.auth.emailLabel}
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.colors.surface,
                        borderColor: theme.colors.surfaceBorder,
                        color: theme.colors.textPrimary,
                      },
                    ]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder={idID.auth.emailPlaceholder}
                    placeholderTextColor={theme.colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel={idID.auth.emailLabel}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                    {idID.auth.passwordLabel}
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.colors.surface,
                        borderColor: theme.colors.surfaceBorder,
                        color: theme.colors.textPrimary,
                      },
                    ]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder={idID.auth.passwordPlaceholder}
                    placeholderTextColor={theme.colors.textMuted}
                    secureTextEntry
                    accessibilityLabel={idID.auth.passwordLabel}
                  />
                </View>

                <Pressable
                  android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isRegisterMode ? idID.auth.registerButton : idID.auth.loginButton
                  }
                  disabled={isLoading}
                  style={[
                    styles.submitButton,
                    { backgroundColor: theme.colors.primary },
                    isLoading && styles.buttonDisabled,
                  ]}
                  onPress={handleEmailSubmit}
                >
                  {isLoading ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator color="#fff" />
                      <Text style={styles.submitButtonText} allowFontScaling>
                        Memproses...
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.submitButtonText} allowFontScaling>
                      {isRegisterMode ? idID.auth.registerButton : idID.auth.loginButton}
                    </Text>
                  )}
                </Pressable>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={
                    isRegisterMode
                      ? idID.auth.toggleToLogin
                      : idID.auth.toggleToRegister
                  }
                  style={styles.toggleModeBtn}
                  onPress={() => {
                    clearError();
                    setIsRegisterMode(!isRegisterMode);
                  }}
                >
                  <Text
                    style={[
                      styles.toggleModeText,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    {isRegisterMode
                      ? idID.auth.toggleToLogin
                      : idID.auth.toggleToRegister}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {/* Tertiary Collapsible: Advanced Server URL */}
          <View style={styles.advancedSection}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.auth.advancedSettings}
              style={styles.advancedToggle}
              onPress={() => setShowAdvancedServer(!showAdvancedServer)}
            >
              <Globe size={14} color={theme.colors.textMuted} />
              <Text style={[styles.advancedToggleText, { color: theme.colors.textMuted }]}>
                {idID.auth.advancedSettings}
              </Text>
              {showAdvancedServer ? (
                <ChevronUp size={14} color={theme.colors.textMuted} />
              ) : (
                <ChevronDown size={14} color={theme.colors.textMuted} />
              )}
            </TouchableOpacity>

            {showAdvancedServer ? (
              <View style={styles.advancedForm}>
                <Text style={[styles.helperText, { color: theme.colors.textMuted }]}>
                  {idID.auth.serverUrlHelper}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.colors.surfaceElevated,
                      borderColor: theme.colors.surfaceBorder,
                      color: theme.colors.textPrimary,
                    },
                  ]}
                  value={urlInput}
                  onChangeText={setUrlInput}
                  placeholder={idID.auth.serverUrlPlaceholder}
                  placeholderTextColor={theme.colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={idID.auth.serverUrlLabel}
                />
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    elevation: 4,
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  errorBox: {
    borderWidth: 1,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
  },
  googleButton: {
    minHeight: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  googleButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  accordionSection: {
    marginTop: 16,
  },
  accordionToggle: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  accordionToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emailFormBox: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    padding: 16,
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  submitButton: {
    minHeight: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  toggleModeBtn: {
    marginTop: 14,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleModeText: {
    fontSize: 13,
  },
  advancedSection: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.2)',
    paddingTop: 14,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
  },
  advancedToggleText: {
    fontSize: 12,
  },
  advancedForm: {
    marginTop: 8,
  },
  helperText: {
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
});
