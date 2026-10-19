import React, { useState } from 'react';
import { Laptop, AlertTriangle } from 'lucide-react';
import { useAgentStore } from './context.ts';
import { Button, Spinner, ThemeSwitcher } from './components/index.ts';
import './Theme.css';
import './components/Components.css';
import './LoginScreen.css';

export const LoginScreen: React.FC = () => {
  const {
    authState,
    loginStep,
    loginError,
    bootstrapMessage,
    serverUrl,
    setServerUrl,
    googleLogin,
    manualLogin,
    clearLoginError,
  } = useAgentStore();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl);
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const isAuthenticating = authState === 'authenticating' || authState === 'bootstrapping';

  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTokenInput.trim()) {
      setManualError('Masukkan token manual terlebih dahulu.');
      return;
    }
    setManualError(null);
    if (serverUrlDraft.trim() && serverUrlDraft !== serverUrl) {
      setServerUrl(serverUrlDraft.trim());
    }
    await manualLogin(manualTokenInput.trim());
  };

  const stepLabels: Record<string, string> = {
    opening_browser: 'Membuka browser untuk login Google...',
    verifying: 'Memverifikasi kredensial autentikasi...',
    registering_device: 'Mendaftarkan identitas perangkat Windows...',
    connecting: 'Menghubungkan ke server WSS...',
    connected: 'Terhubung!',
  };

  return (
    <div className="login-screen-container">
      {/* Top right controls */}
      <div className="login-theme-switcher-wrapper">
        <ThemeSwitcher />
      </div>

      {/* Main Login Card */}
      <div className="card login-card">
        {/* Logo and Brand Header */}
        <div className="login-header">
          <div className="login-logo-icon">
            <Laptop size={26} />
          </div>
          <h1 className="login-title">
            Personal AI OS
          </h1>
          <p className="login-subtitle">
            Satu asisten pribadi terpadu dengan eksekusi lokal aman di Windows.
          </p>
        </div>

        {/* State: Bootstrapping (Reopening with existing credentials) */}
        {authState === 'bootstrapping' && (
          <div className="login-state-box" aria-live="polite">
            <Spinner size="lg" />
            <p className="login-state-text">
              {bootstrapMessage ?? 'Memverifikasi sesi...'}
            </p>
          </div>
        )}

        {/* State: Authenticating in flight */}
        {authState === 'authenticating' && (
          <div className="login-state-box" aria-live="polite">
            <Spinner size="lg" />
            <div>
              <p className="login-state-title">
                {stepLabels[loginStep] ?? 'Memproses login...'}
              </p>
              <p className="login-state-desc">
                {loginStep === 'opening_browser'
                  ? 'Silakan selesaikan proses masuk pada jendela peramban yang terbuka.'
                  : 'Mohon tunggu sejenak, mengonfigurasi sesi Anda...'}
              </p>
            </div>
          </div>
        )}

        {/* State: Error alert */}
        {loginStep === 'error' && loginError && (
          <div className="login-error-card" role="alert">
            <div className="login-error-content">
              <AlertTriangle size={18} className="login-error-alert-icon" />
              <div className="login-error-msg">
                <strong>Gagal Masuk:</strong> {loginError}
              </div>
            </div>
            <div className="login-error-actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  clearLoginError();
                  void googleLogin();
                }}
              >
                Coba lagi
              </Button>
            </div>
          </div>
        )}

        {/* State: Unauthenticated (Clean 1-step Google Login) */}
        {!isAuthenticating && (
          <div className="login-unauth-section">
            <button
              className="ui-btn ui-btn-primary ui-btn-lg login-google-btn"
              onClick={() => void googleLogin()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Masuk dengan Google</span>
            </button>

            {/* Discreet Advanced Toggle */}
            <div className="login-advanced-toggle-wrap">
              <button
                type="button"
                className="login-advanced-toggle-btn"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? 'Tutup Opsi Lanjutan ▲' : 'Lanjutan (Opsi Pengembang) ▼'}
              </button>
            </div>

            {/* Advanced Section */}
            {showAdvanced && (
              <form
                onSubmit={(e) => void handleManualLogin(e)}
                className="login-advanced-form"
              >
                <div>
                  <label className="login-field-label">
                    URL Server VPS (Control Plane):
                  </label>
                  <input
                    type="text"
                    className="text-input login-field-input"
                    value={serverUrlDraft}
                    onChange={(e) => setServerUrlDraft(e.target.value)}
                    placeholder="https://ai.ojixx.my.id"
                  />
                </div>

                <div>
                  <label className="login-field-label">
                    Token Manual Pengembang:
                  </label>
                  <input
                    type="password"
                    className="text-input login-field-input"
                    value={manualTokenInput}
                    onChange={(e) => setManualTokenInput(e.target.value)}
                    placeholder="Tempel token akses di sini..."
                  />
                </div>

                {manualError && (
                  <div className="login-manual-error">
                    {manualError}
                  </div>
                )}

                <button
                  type="submit"
                  className="ui-btn ui-btn-secondary ui-btn-sm login-manual-submit-btn"
                >
                  Gunakan Token & Hubungkan
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Footer text */}
      <footer className="login-footer">
        Personal AI OS · Sesi Aman Berbasis PKCE & Sandboxing
      </footer>
    </div>
  );
};
