import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Flame,
  Globe,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  AlertTriangle,
} from 'lucide-react-native';
import {
  parseCitations,
  reduceResearchProgress,
  type ParsedCitation,
  type ResearchProgressState,
  type ResearchSubQuestionState,
  type SubQuestionStatus,
  type TaskEventEnvelope,
} from '@personal-ai-os/shared';
import { defaultApiClient } from '../api/client.ts';
import { deriveWsUrl, getInitialApiUrl } from '../api/config.ts';
import { defaultTokenStorage } from '../storage/secure-store.ts';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useUiStore } from '../state/ui-store.ts';
import { idID } from '../locales/id-ID.ts';
import { SourceBottomSheet } from '../components/SourceBottomSheet.tsx';

interface ResearchScreenProps {
  runId: string;
  onBack: () => void;
}

export const ResearchScreen: React.FC<ResearchScreenProps> = ({ runId, onBack }) => {
  const theme = useAppTheme();
  const { showToast } = useUiStore();

  const [researchState, setResearchState] = useState<ResearchProgressState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Plan editing state for waiting_plan_approval
  const [editableQuestions, setEditableQuestions] = useState<ResearchSubQuestionState[]>([]);
  const [newQuestionText, setNewQuestionText] = useState('');

  // Selected citation for bottom sheet
  const [selectedCitation, setSelectedCitation] = useState<ParsedCitation | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const lastEventIdRef = useRef<string | null>(null);

  // Fetch initial run data
  const fetchRunDetails = useCallback(async () => {
    try {
      const details = await defaultApiClient.getResearch(runId);
      const planObj = details.run.plan as { subQuestions?: ResearchSubQuestionState[] } | undefined;
      const initial: ResearchProgressState = {
        runId: details.run.id,
        status: details.run.status,
        query: details.run.query,
        depth: details.run.depth,
        plan: planObj ? { subQuestions: planObj.subQuestions ?? [] } : undefined,
        subQuestions: planObj?.subQuestions ?? [],
        sources: details.sources ?? [],
        evidence: details.evidence ?? [],
        report: details.report ?? undefined,
        budgetConfig: details.run.budgetConfig,
        budgetUsed: details.run.budgetUsed,
        seenEventIds: [],
        updatedAt: Date.now(),
      };

      setResearchState(initial);
      if (initial.subQuestions.length > 0) {
        setEditableQuestions(initial.subQuestions);
      }
    } catch {
      showToast('Gagal memuat rincian riset.');
    } finally {
      setIsLoading(false);
    }
  }, [runId, showToast]);

  // Connect WebSocket for live events
  useEffect(() => {
    void fetchRunDetails();

    let isMounted = true;
    let ws: WebSocket | null = null;

    const connectWs = async () => {
      const token = await defaultTokenStorage.getAccessToken();
      if (!token || !isMounted) return;

      const serverUrl = getInitialApiUrl();
      const wsBase = deriveWsUrl(serverUrl);
      const params = new URLSearchParams({ token, taskId: runId });
      if (lastEventIdRef.current) params.set('last_event_id', lastEventIdRef.current);

      ws = new WebSocket(`${wsBase}/v1/events/ws?${params.toString()}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const envelope = JSON.parse(String(event.data)) as TaskEventEnvelope;
          if (!envelope?.eventType) return;
          if (envelope.id) lastEventIdRef.current = envelope.id;

          setResearchState((prev) => {
            if (!prev) return prev;
            const next = reduceResearchProgress(prev, envelope);
            if (next.subQuestions.length > 0 && prev.subQuestions.length === 0) {
              setEditableQuestions(next.subQuestions);
            }
            return next;
          });
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (isMounted) {
          // Reconnect with backoff
          setTimeout(() => {
            if (isMounted) void connectWs();
          }, 3000);
        }
      };
    };

    void connectWs();

    return () => {
      isMounted = false;
      if (ws) ws.close();
      wsRef.current = null;
    };
  }, [fetchRunDetails, runId]);

  // Actions
  const handleApprovePlan = async () => {
    const validQuestions = editableQuestions.filter((q) => q.question.trim().length > 0);
    if (validQuestions.length === 0) {
      Alert.alert('Perhatian', idID.research.planReview.emptyQuestions);
      return;
    }
    setIsActionLoading(true);
    try {
      await defaultApiClient.approveResearchPlan(runId, { subQuestions: validQuestions });
      setResearchState((prev) =>
        prev
          ? {
              ...prev,
              status: 'running',
              subQuestions: validQuestions,
            }
          : prev,
      );
      showToast('Rencana riset disetujui, investigasi dimulai.');
    } catch {
      showToast('Gagal menyetujui rencana riset.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCancelResearch = () => {
    Alert.alert('Konfirmasi', 'Hentikan proses riset ini?', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hentikan',
        style: 'destructive',
        onPress: async () => {
          setIsActionLoading(true);
          try {
            await defaultApiClient.cancelResearch(runId);
            setResearchState((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
            showToast('Riset dihentikan.');
          } catch {
            showToast('Gagal menghentikan riset.');
          } finally {
            setIsActionLoading(false);
          }
        },
      },
    ]);
  };

  const handleCopyReport = () => {
    if (!researchState?.report?.contentMarkdown) return;
    Clipboard.setString(researchState.report.contentMarkdown);
    setCopied(true);
    showToast(idID.research.report.copied);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddQuestion = () => {
    if (!newQuestionText.trim()) return;
    const newId = `sub-${Date.now().toString(36)}`;
    setEditableQuestions((prev) => [
      ...prev,
      {
        id: newId,
        question: newQuestionText.trim(),
        searchQueries: [newQuestionText.trim()],
        status: 'waiting',
      },
    ]);
    setNewQuestionText('');
  };

  const handleDeleteQuestion = (id: string) => {
    if (editableQuestions.length <= 1) {
      Alert.alert('Perhatian', idID.research.planReview.emptyQuestions);
      return;
    }
    setEditableQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  if (isLoading || !researchState) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
          Memuat data riset...
        </Text>
      </View>
    );
  }

  const citationMap = researchState.report
    ? parseCitations(researchState.report.contentMarkdown, researchState.sources, researchState.evidence)
    : new Map();

  const getSubQuestionIcon = (status: SubQuestionStatus) => {
    switch (status) {
      case 'waiting':
        return <Clock size={13} color={theme.colors.textMuted} />;
      case 'searching':
        return <Search size={13} color={theme.colors.primary} />;
      case 'reading':
        return <BookOpen size={13} color={theme.colors.primary} />;
      case 'extracting':
        return <Sparkles size={13} color={theme.colors.warning} />;
      case 'completed':
        return <CheckCircle2 size={13} color={theme.colors.success} />;
    }
  };

  const renderTextWithCitations = (text: string) => {
    const parts = text.split(/(\[src-\d+\])/g);
    return parts.map((part, index) => {
      const match = part.match(/^\[src-(\d+)\]$/);
      if (match) {
        const citationId = `src-${match[1]}`;
        const citation = citationMap.get(citationId) || {
          citationId,
          number: parseInt(match[1]!, 10),
          isValid: false,
          label: `[src-${match[1]}: Tidak ditemukan]`,
        };

        return (
          <TouchableOpacity
            key={index}
            style={[
              styles.inlineCitationChip,
              {
                backgroundColor: citation.isValid ? theme.colors.surface : theme.colors.dangerBg,
                borderColor: citation.isValid ? theme.colors.primary : theme.colors.danger,
              },
            ]}
            onPress={() => setSelectedCitation(citation)}
            accessibilityRole="button"
            accessibilityLabel={`Buka sitasi ${citation.number}`}
          >
            <Text
              style={[
                styles.inlineCitationText,
                { color: citation.isValid ? theme.colors.primary : theme.colors.danger },
              ]}
            >
              [src-{citation.number}]
            </Text>
          </TouchableOpacity>
        );
      }
      return (
        <Text key={index} style={[styles.bodyText, { color: theme.colors.textPrimary }]}>
          {part}
        </Text>
      );
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Screen Header */}
      <View style={[styles.header, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Kembali"
        >
          <ArrowLeft size={20} color={theme.colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]} numberOfLines={1} allowFontScaling>
            {researchState.query}
          </Text>
          <View style={styles.headerBadgeRow}>
            <View style={[styles.depthBadge, { backgroundColor: theme.colors.surface }]}>
              <Text style={[styles.depthBadgeText, { color: theme.colors.primary }]}>
                {researchState.depth === 'quick' ? 'Cepat' : researchState.depth === 'deep' ? 'Mendalam' : 'Standar'}
              </Text>
            </View>
            <Text style={[styles.statusText, { color: theme.colors.textSecondary }]}>
              {researchState.status === 'running'
                ? 'Sedang Berjalan'
                : researchState.status === 'waiting_plan_approval'
                ? 'Tinjau Rencana'
                : researchState.status === 'completed'
                ? 'Selesai'
                : researchState.status === 'cancelled'
                ? 'Dibatalkan'
                : 'Gagal'}
            </Text>
          </View>
        </View>

        {researchState.status === 'completed' && (
          <TouchableOpacity
            style={[styles.headerActionBtn, { backgroundColor: theme.colors.surface }]}
            onPress={handleCopyReport}
            accessibilityRole="button"
            accessibilityLabel="Salin laporan"
          >
            {copied ? <Check size={16} color={theme.colors.success} /> : <Copy size={16} color={theme.colors.textPrimary} />}
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Waiting Plan Approval Stage */}
        {researchState.status === 'waiting_plan_approval' && (
          <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.primary }]}>
            <View style={styles.planHeader}>
              <Sparkles size={20} color={theme.colors.primary} />
              <View style={styles.planHeaderText}>
                <Text style={[styles.planTitle, { color: theme.colors.textPrimary }]} allowFontScaling>
                  {idID.research.planReview.title}
                </Text>
                <Text style={[styles.planDesc, { color: theme.colors.textSecondary }]} allowFontScaling>
                  {idID.research.planReview.subtitle}
                </Text>
              </View>
            </View>

            <View style={styles.subQuestionsList}>
              {editableQuestions.map((sq, index) => (
                <View key={sq.id} style={styles.sqRow}>
                  <Text style={[styles.sqNum, { color: theme.colors.textSecondary }]}>{index + 1}.</Text>
                  <TextInput
                    style={[styles.sqInput, { backgroundColor: theme.colors.surface, color: theme.colors.textPrimary, borderColor: theme.colors.surfaceBorder }]}
                    value={sq.question}
                    onChangeText={(txt) => {
                      setEditableQuestions((prev) =>
                        prev.map((item) => (item.id === sq.id ? { ...item, question: txt } : item)),
                      );
                    }}
                    placeholder={idID.research.planReview.subQuestionPlaceholder}
                    placeholderTextColor={theme.colors.textMuted}
                  />
                  <TouchableOpacity
                    style={styles.sqDeleteBtn}
                    onPress={() => handleDeleteQuestion(sq.id)}
                    disabled={editableQuestions.length <= 1}
                  >
                    <Trash2 size={16} color={theme.colors.danger} />
                  </TouchableOpacity>
                </View>
              ))}

              {/* Add question row */}
              <View style={styles.addSqRow}>
                <TextInput
                  style={[styles.sqInput, { backgroundColor: theme.colors.surface, color: theme.colors.textPrimary, borderColor: theme.colors.surfaceBorder }]}
                  value={newQuestionText}
                  onChangeText={setNewQuestionText}
                  placeholder={idID.research.planReview.addSubQuestion + '...'}
                  placeholderTextColor={theme.colors.textMuted}
                />
                <TouchableOpacity
                  style={[styles.addSqBtn, { backgroundColor: theme.colors.surface }]}
                  onPress={handleAddQuestion}
                  disabled={!newQuestionText.trim()}
                >
                  <Plus size={16} color={theme.colors.primary} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.planActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: theme.colors.surfaceBorder }]}
                onPress={handleCancelResearch}
                disabled={isActionLoading}
              >
                <Text style={[styles.cancelBtnText, { color: theme.colors.textPrimary }]}>Batalkan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.approveBtn, { backgroundColor: theme.colors.primary }]}
                onPress={() => void handleApprovePlan()}
                disabled={isActionLoading}
              >
                <Text style={styles.approveBtnText}>
                  {isActionLoading ? 'Memulai...' : idID.research.planReview.approveAndStart}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Live Progress Stage */}
        {(researchState.status === 'running' || researchState.status === 'planning' || researchState.status === 'queued') && (
          <View style={styles.liveContainer}>
            {/* Budget Counters Card */}
            <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
              <View style={styles.budgetRow}>
                <View style={styles.budgetItem}>
                  <Text style={[styles.budgetLabel, { color: theme.colors.textMuted }]}>Pencarian</Text>
                  <Text style={[styles.budgetValue, { color: theme.colors.textPrimary }]}>
                    {researchState.budgetUsed.searchesCount} / {researchState.budgetConfig.maxSearches}
                  </Text>
                </View>
                <View style={styles.budgetItem}>
                  <Text style={[styles.budgetLabel, { color: theme.colors.textMuted }]}>Halaman</Text>
                  <Text style={[styles.budgetValue, { color: theme.colors.textPrimary }]}>
                    {researchState.budgetUsed.pagesReadCount} / {researchState.budgetConfig.maxPagesRead}
                  </Text>
                </View>
                <View style={styles.budgetItem}>
                  <Text style={[styles.budgetLabel, { color: theme.colors.textMuted }]}>Waktu</Text>
                  <Text style={[styles.budgetValue, { color: theme.colors.textPrimary }]}>
                    {Math.round(researchState.budgetUsed.durationMs / 1000)} dtk
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.stopBtn, { backgroundColor: theme.colors.dangerBg, borderColor: theme.colors.danger }]}
                onPress={handleCancelResearch}
                disabled={isActionLoading}
              >
                <Square size={13} color={theme.colors.danger} fill={theme.colors.danger} />
                <Text style={[styles.stopBtnText, { color: theme.colors.danger }]}>Hentikan Riset</Text>
              </TouchableOpacity>
            </View>

            {/* Timeline of Sub-Questions */}
            <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
              <View style={styles.timelineHeader}>
                <Flame size={16} color={theme.colors.warning} />
                <Text style={[styles.timelineTitle, { color: theme.colors.textPrimary }]}>Progres Investigasi</Text>
              </View>

              {researchState.subQuestions.map((sq, index) => (
                <View key={sq.id} style={styles.timelineItem}>
                  <View style={styles.timelineIconWrap}>{getSubQuestionIcon(sq.status)}</View>
                  <View style={styles.timelineContent}>
                    <Text style={[styles.timelineSqText, { color: theme.colors.textPrimary }]}>
                      {index + 1}. {sq.question}
                    </Text>
                    <Text style={[styles.timelineSqStatus, { color: theme.colors.textSecondary }]}>
                      {sq.status === 'waiting'
                        ? 'Menunggu'
                        : sq.status === 'searching'
                        ? 'Mencari...'
                        : sq.status === 'reading'
                        ? 'Membaca...'
                        : sq.status === 'extracting'
                        ? 'Mengekstrak bukti...'
                        : 'Selesai'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Completed Report Stage */}
        {researchState.status === 'completed' && researchState.report && (
          <View style={styles.reportContainer}>
            {/* Report Header Card */}
            <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
              <Text style={[styles.reportTitle, { color: theme.colors.textPrimary }]} allowFontScaling>
                {researchState.report.title}
              </Text>
              {researchState.report.summary ? (
                <Text style={[styles.reportSummary, { color: theme.colors.textSecondary }]} allowFontScaling>
                  {researchState.report.summary}
                </Text>
              ) : null}

              {/* Source count pill */}
              <View style={[styles.sourcesSummaryPill, { backgroundColor: theme.colors.surface }]}>
                <Globe size={14} color={theme.colors.primary} />
                <Text style={[styles.sourcesSummaryText, { color: theme.colors.primary }]}>
                  {researchState.sources.length} Sumber Rujukan Terverifikasi
                </Text>
              </View>
            </View>

            {/* Confidence Bars */}
            {Object.keys(researchState.report.confidenceBySection || {}).length > 0 && (
              <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
                <Text style={[styles.confidenceTitle, { color: theme.colors.textPrimary }]}>Tingkat Keyakinan per Bagian</Text>
                {Object.entries(researchState.report.confidenceBySection).map(([sec, score]) => {
                  const pct = Math.round(score * 100);
                  const color = pct >= 80 ? theme.colors.success : pct >= 60 ? theme.colors.warning : theme.colors.danger;
                  return (
                    <View key={sec} style={styles.confidenceRow}>
                      <View style={styles.confidenceHeader}>
                        <Text style={[styles.confidenceSecName, { color: theme.colors.textSecondary }]}>{sec}</Text>
                        <Text style={[styles.confidencePct, { color }]}>{pct}%</Text>
                      </View>
                      <View style={[styles.trackBar, { backgroundColor: theme.colors.surface }]}>
                        <View style={[styles.fillBar, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Markdown Report Body with Citations */}
            <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
              <View style={styles.markdownBody}>
                {researchState.report.contentMarkdown.split('\n\n').map((paragraph, idx) => (
                  <View key={idx} style={styles.paragraphContainer}>
                    <Text style={styles.paragraphWrap}>{renderTextWithCitations(paragraph)}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Information Gaps Section */}
            {researchState.report.gaps && researchState.report.gaps.length > 0 && (
              <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.warning }]}>
                <View style={styles.gapsHeader}>
                  <AlertTriangle size={16} color={theme.colors.warning} />
                  <Text style={[styles.gapsTitle, { color: theme.colors.warning }]}>
                    Yang Tidak Ditemukan (Information Gaps)
                  </Text>
                </View>
                {researchState.report.gaps.map((gap, i) => (
                  <Text key={i} style={[styles.gapItem, { color: theme.colors.textPrimary }]}>
                    • {gap}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Failed or Cancelled Banner */}
        {(researchState.status === 'failed' || researchState.status === 'cancelled') && (
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: researchState.status === 'cancelled' ? theme.colors.warning : theme.colors.danger,
              },
            ]}
          >
            <View style={styles.errorHeader}>
              <ShieldAlert
                size={18}
                color={researchState.status === 'cancelled' ? theme.colors.warning : theme.colors.danger}
              />
              <Text
                style={[
                  styles.errorTitle,
                  { color: researchState.status === 'cancelled' ? theme.colors.warning : theme.colors.danger },
                ]}
              >
                {researchState.status === 'cancelled' ? 'Riset Dibatalkan' : 'Riset Gagal'}
              </Text>
            </View>
            <Text style={[styles.errorDesc, { color: theme.colors.textSecondary }]}>
              {researchState.error ||
                (researchState.status === 'cancelled'
                  ? idID.research.errors.cancelledByUser
                  : idID.research.errors.genericError)}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Citation Bottom Sheet */}
      <SourceBottomSheet
        isOpen={Boolean(selectedCitation)}
        onClose={() => setSelectedCitation(null)}
        source={selectedCitation?.source ?? null}
        quote={selectedCitation?.quote ?? null}
        citationNumber={selectedCitation?.number}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: {
    padding: 6,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  depthBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  depthBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusText: {
    fontSize: 11,
  },
  headerActionBtn: {
    padding: 8,
    borderRadius: 8,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  planHeaderText: {
    flex: 1,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  planDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  subQuestionsList: {
    gap: 10,
    marginTop: 6,
  },
  sqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sqNum: {
    fontSize: 13,
    fontWeight: '600',
  },
  sqInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  sqDeleteBtn: {
    padding: 6,
  },
  addSqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  addSqBtn: {
    padding: 10,
    borderRadius: 8,
  },
  planActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  approveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  approveBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  liveContainer: {
    gap: 16,
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  budgetItem: {
    alignItems: 'center',
  },
  budgetLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  budgetValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    marginTop: 4,
  },
  stopBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  timelineIconWrap: {
    marginTop: 2,
  },
  timelineContent: {
    flex: 1,
  },
  timelineSqText: {
    fontSize: 13,
    fontWeight: '500',
  },
  timelineSqStatus: {
    fontSize: 11,
    marginTop: 2,
  },
  reportContainer: {
    gap: 16,
  },
  reportTitle: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
  },
  reportSummary: {
    fontSize: 13,
    lineHeight: 19,
  },
  sourcesSummaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 6,
    marginTop: 4,
  },
  sourcesSummaryText: {
    fontSize: 12,
    fontWeight: '600',
  },
  confidenceTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  confidenceRow: {
    gap: 4,
  },
  confidenceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  confidenceSecName: {
    fontSize: 12,
  },
  confidencePct: {
    fontSize: 12,
    fontWeight: '700',
  },
  trackBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fillBar: {
    height: '100%',
    borderRadius: 2,
  },
  markdownBody: {
    gap: 12,
  },
  paragraphContainer: {
    marginBottom: 4,
  },
  paragraphWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    lineHeight: 22,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 22,
  },
  inlineCitationChip: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    marginHorizontal: 2,
  },
  inlineCitationText: {
    fontSize: 11,
    fontWeight: '700',
  },
  gapsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gapsTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  gapItem: {
    fontSize: 13,
    lineHeight: 18,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  errorDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
});
