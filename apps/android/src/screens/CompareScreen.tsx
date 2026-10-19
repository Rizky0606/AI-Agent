import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowLeft,
  Columns2,
  Copy,
  Check,
  Eye,
  EyeOff,
  Sparkles,
  Trophy,
  AlertCircle,
  Clock,
  Cpu,
  Coins,
  Plus,
  History,
  MessageSquareShare,
  ShieldCheck,
} from 'lucide-react-native';
import {
  compareReducer,
  type CompareColumnResult,
  type CompareRunDetail,
  type CompareRunSummary,
  type TaskEventEnvelope,
} from '@personal-ai-os/shared';
import { defaultApiClient } from '../api/client.ts';
import { deriveWsUrl, getInitialApiUrl } from '../api/config.ts';
import { defaultTokenStorage } from '../storage/secure-store.ts';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useUiStore } from '../state/ui-store.ts';
import { idID } from '../locales/id-ID.ts';

interface CompareScreenProps {
  runId?: string | null;
  onBack: () => void;
  onNavigateToChat?: (conversationId?: string) => void;
}

export const CompareScreen: React.FC<CompareScreenProps> = ({
  runId,
  onBack,
  onNavigateToChat,
}) => {
  const theme = useAppTheme();
  const { showToast } = useUiStore();

  const [compareState, setCompareState] = useState<CompareRunDetail | null>(null);
  const [selectedColumnIndex, setSelectedColumnIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Form states for new comparison
  const [prompt, setPrompt] = useState('');
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [blindMode, setBlindMode] = useState(true);
  const [requestSynthesis, setRequestSynthesis] = useState(false);
  const [availableModels, setAvailableModels] = useState<
    Array<{ id: string; name?: string | undefined; provider: string }>
  >([]);

  // History state
  const [history, setHistory] = useState<CompareRunSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  // Load catalog and history
  const loadInitialData = useCallback(async () => {
    try {
      const [catRes, histRes] = await Promise.all([
        defaultApiClient.listModels(),
        defaultApiClient.listCompares(),
      ]);
      setAvailableModels(catRes.models ?? []);
      setHistory(histRes ?? []);

      // Pre-select 2 models if none chosen
      if (selectedModelIds.length === 0 && (catRes.models?.length ?? 0) >= 2) {
        setSelectedModelIds(catRes.models.slice(0, 2).map((m) => m.id));
      }
    } catch {
      // ignore
    }
  }, [selectedModelIds.length]);

  const loadRun = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const detail = await defaultApiClient.getCompare(id);
      setCompareState(detail);
      setSelectedColumnIndex(0);
    } catch {
      showToast('Gagal memuat rincian perbandingan.');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (runId) {
      void loadRun(runId);
    }
  }, [runId, loadRun]);

  // WebSocket event listener for live streaming
  useEffect(() => {
    if (!compareState?.id) return;
    if (compareState.status !== 'running' && compareState.status !== 'queued') return;

    let isSubscribed = true;

    async function connectWs() {
      try {
        const token = await defaultTokenStorage.getAccessToken();
        if (!token || !isSubscribed) return;

        const baseUrl = getInitialApiUrl();
        const wsBase = deriveWsUrl(baseUrl);
        const wsUrl = `${wsBase}/v1/events/ws?token=${encodeURIComponent(token)}&taskId=${encodeURIComponent(compareState!.id)}`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          if (!isSubscribed) return;
          try {
            const envelope = JSON.parse(event.data as string) as TaskEventEnvelope;
            setCompareState((current) => {
              if (!current) return current;
              return compareReducer(current, envelope);
            });
          } catch {
            // ignore
          }
        };

        ws.onerror = () => {
          // handled quietly
        };
      } catch {
        // ignore
      }
    }

    void connectWs();

    return () => {
      isSubscribed = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [compareState?.id, compareState?.status]);

  const handleToggleModel = (id: string) => {
    if (selectedModelIds.includes(id)) {
      setSelectedModelIds(selectedModelIds.filter((m) => m !== id));
    } else {
      if (selectedModelIds.length >= 3) {
        showToast('Maksimal 3 model untuk satu perbandingan.');
        return;
      }
      setSelectedModelIds([...selectedModelIds, id]);
    }
  };

  const handleStartCompare = async () => {
    if (!prompt.trim() || selectedModelIds.length < 2 || selectedModelIds.length > 3) {
      showToast(idID.compare.startCompareDisabledReason);
      return;
    }

    setIsActionLoading(true);
    try {
      const summary = await defaultApiClient.createCompare({
        prompt: prompt.trim(),
        modelIds: selectedModelIds,
        blindMode,
        requestSynthesis,
      });
      setPrompt('');
      await loadRun(summary.id);
      void loadInitialData();
      showToast('Perbandingan multi-model dimulai.');
    } catch {
      showToast('Gagal memulai perbandingan.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleReveal = async () => {
    if (!compareState?.id) return;
    setIsActionLoading(true);
    try {
      const updated = await defaultApiClient.revealCompare(compareState.id);
      setCompareState(updated);
      showToast('Identitas model berhasil diungkap.');
    } catch {
      showToast('Gagal mengungkap identitas model.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSelectWinner = async (modelId: string | undefined) => {
    if (!compareState?.id || !modelId) return;
    setIsActionLoading(true);
    try {
      const updated = await defaultApiClient.selectCompareWinner(compareState.id, modelId);
      setCompareState(updated);
      showToast('Pemenang berhasil dipilih!');
    } catch {
      showToast('Gagal memilih pemenang.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSynthesize = async () => {
    if (!compareState?.id) return;
    setIsActionLoading(true);
    try {
      const updated = await defaultApiClient.synthesizeCompare(compareState.id);
      setCompareState(updated);
      showToast('Sintesis perbandingan selesai dibuat.');
    } catch {
      showToast('Gagal membuat sintesis.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handlePromote = async () => {
    if (!compareState?.id) return;
    setIsActionLoading(true);
    try {
      const res = await defaultApiClient.promoteCompare(compareState.id, { target: 'new' });
      showToast(idID.compare.promotedSuccess);
      if (onNavigateToChat) {
        onNavigateToChat(res.conversationId);
      }
    } catch {
      showToast('Gagal mempromosikan jawaban ke percakapan.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    if (!text) return;
    Clipboard.setString(text);
    setCopied(true);
    showToast(idID.common.copied);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDeleteHistory = async (id: string) => {
    Alert.alert('Hapus Perbandingan', 'Hapus perbandingan ini dari riwayat?', [
      { text: idID.common.cancel, style: 'cancel' },
      {
        text: idID.common.delete,
        style: 'destructive',
        onPress: async () => {
          try {
            await defaultApiClient.deleteCompare(id);
            setHistory((prev) => prev.filter((h) => h.id !== id));
            if (compareState?.id === id) {
              setCompareState(null);
            }
            showToast('Perbandingan dihapus.');
          } catch {
            showToast('Gagal menghapus perbandingan.');
          }
        },
      },
    ]);
  };

  const currentResult: CompareColumnResult | undefined =
    compareState?.results[selectedColumnIndex];

  const isModelHidden = compareState?.blindMode && !compareState?.isRevealed;
  const currentDisplayName = currentResult
    ? isModelHidden
      ? currentResult.columnLabel
      : (currentResult.modelId || currentResult.columnLabel)
    : '';

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header Bar */}
      <View style={[styles.header, { borderBottomColor: theme.colors.surfaceBorder }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={idID.common.back}
          >
            <ArrowLeft size={22} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.titleContainer}>
            <View style={styles.titleRow}>
              <Columns2 size={18} color={theme.colors.primary} />
              <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
                {idID.compare.title}
              </Text>
            </View>
            <Text style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>
              {idID.compare.subtitle}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: theme.colors.surfaceElevated }]}
            onPress={() => setShowHistory(!showHistory)}
            accessibilityRole="button"
            accessibilityLabel={idID.compare.historyTitle}
          >
            <History size={18} color={theme.colors.textPrimary} />
          </TouchableOpacity>

          {compareState ? (
            <TouchableOpacity
              style={[styles.iconButton, { backgroundColor: theme.colors.primary }]}
              onPress={() => setCompareState(null)}
              accessibilityRole="button"
              accessibilityLabel={idID.compare.newComparison}
            >
              <Plus size={18} color="#ffffff" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* History Drawer / Modal view if toggled */}
      {showHistory ? (
        <View style={[styles.historyOverlay, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
          <View style={styles.historyHeader}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
              {idID.compare.historyTitle}
            </Text>
            <TouchableOpacity onPress={() => setShowHistory(false)}>
              <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>Tutup</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.historyList}>
            {history.length === 0 ? (
              <Text style={[styles.emptyHistoryText, { color: theme.colors.textSecondary }]}>
                {idID.compare.historyEmpty}
              </Text>
            ) : (
              history.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.historyCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}
                  onPress={() => {
                    setShowHistory(false);
                    void loadRun(item.id);
                  }}
                >
                  <Text style={[styles.historyPrompt, { color: theme.colors.textPrimary }]} numberOfLines={2}>
                    {item.prompt}
                  </Text>
                  <View style={styles.historyMetaRow}>
                    <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                      {item.modelIds.length} model • {item.status}
                    </Text>
                    <TouchableOpacity onPress={() => void handleDeleteHistory(item.id)}>
                      <Text style={{ fontSize: 11, color: theme.colors.danger }}>Hapus</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      ) : null}

      {/* Main Content Area */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
            {idID.common.loading}
          </Text>
        </View>
      ) : compareState ? (
        /* Active Run Presentation */
        <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
          {/* Overview Banner */}
          <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
            <View style={styles.bannerTopRow}>
              <View style={styles.badgesRow}>
                <View style={[styles.statusBadge, { backgroundColor: compareState.status === 'completed' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)' }]}>
                  <Text style={{ fontSize: 11, color: theme.colors.primary, fontWeight: '600' }}>
                    {compareState.status === 'running'
                      ? idID.compare.status.running
                      : compareState.status === 'completed'
                        ? idID.compare.status.completed
                        : compareState.status}
                  </Text>
                </View>

                {compareState.blindMode ? (
                  <View style={[styles.statusBadge, { backgroundColor: compareState.isRevealed ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)' }]}>
                    <Text style={{ fontSize: 11, color: compareState.isRevealed ? theme.colors.primary : '#f59e0b', fontWeight: '600' }}>
                      {compareState.isRevealed ? idID.compare.revealedBadge : idID.compare.blindModeBadge}
                    </Text>
                  </View>
                ) : null}
              </View>

              {compareState.blindMode && !compareState.isRevealed ? (
                <TouchableOpacity
                  style={[styles.smallActionBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}
                  onPress={handleReveal}
                  disabled={isActionLoading}
                >
                  <Eye size={13} color={theme.colors.textPrimary} />
                  <Text style={[styles.smallActionText, { color: theme.colors.textPrimary }]}>
                    {idID.compare.revealAction}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={[styles.promptText, { color: theme.colors.textPrimary, backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
              {compareState.prompt}
            </Text>

            <View style={styles.noticeRow}>
              <ShieldCheck size={14} color={theme.colors.primary} />
              <Text style={[styles.noticeText, { color: theme.colors.textSecondary }]}>
                {idID.compare.noFallbackNotice}
              </Text>
            </View>
          </View>

          {/* Column Selector Segmented Tabs (Horizontal Swipe / Tabs) */}
          <View style={[styles.tabsRow, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
            {compareState.results.map((res, idx) => {
              const isSelected = idx === selectedColumnIndex;
              const isWinner = compareState.winnerModelId === res.modelId;
              const label = isModelHidden ? res.columnLabel : (res.modelId || res.columnLabel);
              return (
                <TouchableOpacity
                  key={res.modelId || res.columnLabel}
                  style={[
                    styles.tabItem,
                    isSelected ? { backgroundColor: theme.colors.primary } : null,
                  ]}
                  onPress={() => setSelectedColumnIndex(idx)}
                >
                  {isWinner ? <Trophy size={12} color={isSelected ? '#ffffff' : '#f59e0b'} /> : null}
                  <Text
                    style={[
                      styles.tabItemText,
                      { color: isSelected ? '#ffffff' : theme.colors.textPrimary },
                    ]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Current Column Display Card */}
          {currentResult ? (
            <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: compareState.winnerModelId === currentResult.modelId ? '#f59e0b' : theme.colors.surfaceBorder }]}>
              {/* Column Header */}
              <View style={styles.columnHeader}>
                <View style={styles.columnTitleGroup}>
                  {isModelHidden ? <EyeOff size={14} color={theme.colors.textSecondary} /> : null}
                  <Text style={[styles.columnModelName, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                    {currentDisplayName}
                  </Text>
                </View>

                {compareState.winnerModelId === currentResult.modelId ? (
                  <View style={styles.winnerBadge}>
                    <Trophy size={11} color="#000000" />
                    <Text style={styles.winnerText}>{idID.compare.winnerBadge}</Text>
                  </View>
                ) : null}
              </View>

              {/* Metrics Row (Only if available from gateway) */}
              {(currentResult.latencyMs !== undefined || currentResult.promptTokens !== undefined || currentResult.estimatedCostUsd !== undefined) ? (
                <View style={[styles.metricsRow, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.surfaceBorder }]}>
                  {currentResult.latencyMs !== undefined ? (
                    <View style={styles.metricItem}>
                      <Clock size={12} color={theme.colors.textSecondary} />
                      <Text style={[styles.metricValue, { color: theme.colors.textPrimary }]}>
                        {currentResult.latencyMs} ms
                      </Text>
                    </View>
                  ) : null}
                  {currentResult.totalTokens !== undefined ? (
                    <View style={styles.metricItem}>
                      <Cpu size={12} color={theme.colors.textSecondary} />
                      <Text style={[styles.metricValue, { color: theme.colors.textPrimary }]}>
                        {currentResult.totalTokens} tok
                      </Text>
                    </View>
                  ) : null}
                  {currentResult.estimatedCostUsd != null ? (
                    <View style={styles.metricItem}>
                      <Coins size={12} color={theme.colors.textSecondary} />
                      <Text style={[styles.metricValue, { color: theme.colors.textPrimary }]}>
                        ${currentResult.estimatedCostUsd.toFixed(5)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Column Content */}
              <View style={styles.columnBody}>
                {currentResult.status === 'failed' ? (
                  <View style={[styles.failedBox, { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
                    <View style={styles.failedHeader}>
                      <AlertCircle size={15} color={theme.colors.danger} />
                      <Text style={{ fontWeight: '600', color: theme.colors.danger, marginLeft: 4 }}>
                        {idID.compare.errorTitle}
                      </Text>
                    </View>
                    <Text style={{ color: theme.colors.danger, fontSize: 13, marginTop: 4 }}>
                      {currentResult.error ?? 'Model gagal merespons.'}
                    </Text>
                    <Text style={{ color: theme.colors.danger, fontSize: 11, marginTop: 8, opacity: 0.85 }}>
                      {idID.compare.noFallbackNotice}
                    </Text>
                  </View>
                ) : currentResult.content ? (
                  <Text style={[styles.resultContentText, { color: theme.colors.textPrimary }]} selectable>
                    {currentResult.content}
                  </Text>
                ) : (
                  <View style={styles.columnLoadingBox}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <Text style={[styles.columnLoadingText, { color: theme.colors.textSecondary }]}>
                      {idID.compare.status.running}
                    </Text>
                  </View>
                )}
              </View>

              {/* Action Buttons Row */}
              <View style={[styles.columnFooter, { borderTopColor: theme.colors.surfaceBorder }]}>
                <TouchableOpacity
                  style={[styles.columnActionBtn, { backgroundColor: theme.colors.surface }]}
                  onPress={() => handleCopy(currentResult.content)}
                  disabled={!currentResult.content}
                >
                  {copied ? <Check size={14} color={theme.colors.success} /> : <Copy size={14} color={theme.colors.textPrimary} />}
                  <Text style={[styles.columnActionText, { color: theme.colors.textPrimary }]}>
                    {copied ? idID.compare.copied : idID.compare.copyAnswer}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.columnActionBtn,
                    { backgroundColor: compareState.winnerModelId === currentResult.modelId ? theme.colors.surface : theme.colors.primary },
                  ]}
                  onPress={() => handleSelectWinner(currentResult.modelId || currentResult.id)}
                  disabled={!currentResult.content && currentResult.status !== 'completed'}
                >
                  <Trophy size={14} color={compareState.winnerModelId === currentResult.modelId ? '#f59e0b' : '#ffffff'} />
                  <Text style={[styles.columnActionText, { color: compareState.winnerModelId === currentResult.modelId ? theme.colors.textPrimary : '#ffffff' }]}>
                    {compareState.winnerModelId === currentResult.modelId ? idID.compare.winnerBadge : idID.compare.pickWinner}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.columnActionBtn, { backgroundColor: theme.colors.surface }]}
                  onPress={() => handlePromote()}
                  disabled={!currentResult.content}
                >
                  <MessageSquareShare size={14} color={theme.colors.textPrimary} />
                  <Text style={[styles.columnActionText, { color: theme.colors.textPrimary }]}>
                    {idID.compare.promoteToChat}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Optional Synthesis Section */}
          {compareState.synthesis ? (
            <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
              <View style={styles.synthesisHeader}>
                <View style={styles.synthesisTitleRow}>
                  <Sparkles size={16} color={theme.colors.primary} />
                  <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
                    Sintesis Perbandingan
                  </Text>
                </View>
                {compareState.synthesisModelId ? (
                  <View style={[styles.synthesisPill, { backgroundColor: theme.colors.surface }]}>
                    <Text style={{ fontSize: 10, color: theme.colors.textSecondary }}>
                      {idID.compare.synthesizedBy(compareState.synthesisModelId)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.resultContentText, { color: theme.colors.textPrimary, marginTop: 8 }]} selectable>
                {compareState.synthesis}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.synthesizePromptBtn, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}
              onPress={handleSynthesize}
              disabled={isActionLoading || compareState.status === 'running'}
            >
              <Sparkles size={16} color={theme.colors.primary} />
              <Text style={[styles.synthesizeBtnText, { color: theme.colors.primary }]}>
                {idID.compare.synthesizeAction}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      ) : (
        /* New Comparison Form */
        <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
          <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
            {/* Prompt input */}
            <Text style={[styles.inputLabel, { color: theme.colors.textPrimary }]}>
              Prompt / Pertanyaan
            </Text>
            <TextInput
              style={[styles.textArea, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder, color: theme.colors.textPrimary }]}
              placeholder={idID.compare.promptPlaceholder}
              placeholderTextColor={theme.colors.textSecondary}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            {/* Model selection chips */}
            <View style={styles.modelsSectionHeader}>
              <Text style={[styles.inputLabel, { color: theme.colors.textPrimary }]}>
                {idID.compare.selectModels}
              </Text>
              <Text style={{ fontSize: 12, color: selectedModelIds.length >= 2 ? theme.colors.success : theme.colors.textSecondary }}>
                {idID.compare.modelsSelectedCount(selectedModelIds.length)}
              </Text>
            </View>

            <View style={styles.modelsGrid}>
              {availableModels.map((m) => {
                const isSelected = selectedModelIds.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[
                      styles.modelChip,
                      {
                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : theme.colors.surface,
                        borderColor: isSelected ? theme.colors.primary : theme.colors.surfaceBorder,
                      },
                    ]}
                    onPress={() => handleToggleModel(m.id)}
                  >
                    <Text
                      style={[
                        styles.modelChipName,
                        { color: isSelected ? theme.colors.primary : theme.colors.textPrimary },
                      ]}
                      numberOfLines={1}
                    >
                      {m.name || m.id}
                    </Text>
                    <Text style={[styles.modelProviderBadge, { color: theme.colors.textSecondary }]}>
                      {m.provider}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Mode Buta & Synthesis Toggles */}
            <View style={[styles.toggleRow, { borderTopColor: theme.colors.surfaceBorder }]}>
              <View style={styles.toggleTextGroup}>
                <Text style={[styles.toggleTitle, { color: theme.colors.textPrimary }]}>
                  {idID.compare.blindMode}
                </Text>
              </View>
              <Switch
                value={blindMode}
                onValueChange={setBlindMode}
                trackColor={{ false: theme.colors.surface, true: theme.colors.primary }}
              />
            </View>

            <View style={[styles.toggleRow, { borderTopColor: theme.colors.surfaceBorder }]}>
              <View style={styles.toggleTextGroup}>
                <Text style={[styles.toggleTitle, { color: theme.colors.textPrimary }]}>
                  {idID.compare.requestSynthesis}
                </Text>
              </View>
              <Switch
                value={requestSynthesis}
                onValueChange={setRequestSynthesis}
                trackColor={{ false: theme.colors.surface, true: theme.colors.primary }}
              />
            </View>

            {/* Start Button */}
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                {
                  backgroundColor:
                    prompt.trim().length > 0 && selectedModelIds.length >= 2 && selectedModelIds.length <= 3 && !isActionLoading
                      ? theme.colors.primary
                      : theme.colors.surface,
                },
              ]}
              onPress={handleStartCompare}
              disabled={
                prompt.trim().length === 0 ||
                selectedModelIds.length < 2 ||
                selectedModelIds.length > 3 ||
                isActionLoading
              }
            >
              {isActionLoading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text
                  style={[
                    styles.primaryBtnText,
                    {
                      color:
                        prompt.trim().length > 0 && selectedModelIds.length >= 2 && selectedModelIds.length <= 3
                          ? '#ffffff'
                          : theme.colors.textSecondary,
                    },
                  ]}
                >
                  {idID.compare.startCompare}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    padding: 6,
    marginRight: 8,
  },
  titleContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyOverlay: {
    position: 'absolute',
    top: 60,
    right: 16,
    left: 16,
    maxHeight: 340,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    zIndex: 100,
    elevation: 8,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  historyList: {
    maxHeight: 280,
  },
  historyCard: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  historyPrompt: {
    fontSize: 13,
    fontWeight: '500',
  },
  historyMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  emptyHistoryText: {
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 20,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  bannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  smallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  smallActionText: {
    fontSize: 11,
    fontWeight: '500',
  },
  promptText: {
    fontSize: 14,
    lineHeight: 20,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  noticeText: {
    fontSize: 11,
    flex: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    gap: 4,
  },
  tabItemText: {
    fontSize: 12,
    fontWeight: '600',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  columnTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  columnModelName: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  winnerBadge: {
    backgroundColor: '#f59e0b',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  winnerText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#000000',
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderBottomWidth: 1,
    marginBottom: 10,
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metricValue: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  columnBody: {
    minHeight: 140,
    marginBottom: 12,
  },
  resultContentText: {
    fontSize: 14,
    lineHeight: 22,
  },
  failedBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  failedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  columnLoadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 30,
  },
  columnLoadingText: {
    fontSize: 13,
  },
  columnFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 6,
  },
  columnActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    gap: 4,
  },
  columnActionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  synthesisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  synthesisTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  synthesisPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  synthesizePromptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  synthesizeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  textArea: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    fontSize: 14,
    minHeight: 90,
    marginBottom: 14,
  },
  modelsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modelsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  modelChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: '48%',
  },
  modelChipName: {
    fontSize: 13,
    fontWeight: '600',
  },
  modelProviderBadge: {
    fontSize: 10,
    marginTop: 2,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingVertical: 12,
  },
  toggleTextGroup: {
    flex: 1,
    marginRight: 10,
  },
  toggleTitle: {
    fontSize: 13,
  },
  primaryBtn: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
  },
});
