import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowLeft,
  Copy,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react-native';
import type { ChatMessage, ChatMode, MessageAttachment } from '../api/types.ts';
import { MarkdownView } from '../components/MarkdownView.tsx';
import { ModelSelectorModal } from '../components/ModelSelectorModal.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useCreateTask, useMessages, useTasks } from '../hooks/use-queries.ts';
import { idID } from '../locales/id-ID.ts';
import { ChatWebSocketClient } from '../services/chat-websocket.ts';
import { TaskEventsWebSocketClient } from '../services/task-events-websocket.ts';
import { useChatStore } from '../state/chat-store.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface ChatScreenProps {
  conversationId: string;
  conversationTitle?: string | undefined;
  onBack: () => void;
}

const MODE_LABELS: Record<ChatMode, string> = {
  auto: 'Mode: Auto',
  fast: 'Mode: Cepat',
  coding: 'Mode: Coding',
  complex: 'Mode: Kompleks',
  research: 'Mode: Riset',
};

const MODES: ChatMode[] = ['auto', 'fast', 'coding', 'complex', 'research'];

export const ChatScreen: React.FC<ChatScreenProps> = ({
  conversationId,
  conversationTitle,
  onBack,
}) => {
  const theme = useAppTheme();
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [selectedMessageForAction, setSelectedMessageForAction] = useState<ChatMessage | null>(null);

  const {
    messages,
    hydrateMessages,
    setConversationId,
    isStreaming,
    isSending,
    isCancelling,
    draftText,
    setDraftText,
    beginSend,
    failSend,
    error,
    selectedModel,
    selectedMode,
    setConversationMode,
    connectionStatus,
    loadCatalog,
    modelCatalogUnavailable,
    modelNotice,
    clearModelNotice,
  } = useChatStore();

  const { showToast } = useUiStore();
  const { data: initialMessages, isLoading: isLoadingInitial, error: historyError, refetch: refetchHistory } =
    useMessages(conversationId);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const wsClientRef = useRef<ChatWebSocketClient | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const activeProjectId = useUiStore((state) => state.activeProjectId);
  const { data: conversationTasks, refetch: refetchConversationTasks } = useTasks({ conversationId });
  const conversationTaskIdsRef = useRef<Set<string>>(new Set());
  conversationTaskIdsRef.current = new Set(conversationTasks?.map((task) => task.id) ?? []);
  const createTask = useCreateTask();

  useEffect(() => {
    setConversationId(conversationId);
    const client = new ChatWebSocketClient({ conversationId });
    wsClientRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      wsClientRef.current = null;
    };
  }, [conversationId, setConversationId]);

  useEffect(() => {
    if (initialMessages) hydrateMessages(conversationId, initialMessages);
  }, [conversationId, initialMessages, hydrateMessages]);

  useEffect(() => {
    const ws = new TaskEventsWebSocketClient({
      onEvent: (event) => {
        if (!conversationTaskIdsRef.current.has(event.taskId)) return;
        void refetchConversationTasks();
      },
    });
    void ws.connect();
    return () => ws.disconnect();
  }, [refetchConversationTasks]);

  const handleSend = (textToSend?: string) => {
    const content = (textToSend ?? draftText).trim();
    if (!content || !wsClientRef.current) return;
    beginSend();
    try {
      wsClientRef.current.sendMessage({
        content,
        model: selectedModel === 'auto' ? undefined : selectedModel,
        mode: selectedMode,
      });
      if (!textToSend) {
        setDraftText('');
      }
    } catch (err) {
      failSend(err instanceof Error ? err.message : 'Unable to send message');
    }
  };

  const handleCancel = () => {
    if (wsClientRef.current) wsClientRef.current.cancelActiveStream();
  };

  const handleRunAsTask = async () => {
    const instruction = draftText.trim();
    if (!instruction || !activeProjectId) return;
    try {
      await createTask.mutateAsync({
        projectId: activeProjectId,
        kind: 'generic_task',
        payload: { prompt: instruction },
        conversationId,
      });
      await refetchConversationTasks();
      showToast('Tugas baru berhasil dibuat dari obrolan.');
    } catch {
      // Handled by query
    }
  };

  const handleCopyMessage = (msg: ChatMessage) => {
    try {
      Clipboard.setString(msg.content);
      showToast(idID.common.copied);
    } catch {
      showToast(idID.common.copied);
    }
    setSelectedMessageForAction(null);
  };

  const handleRetryMessage = (msg: ChatMessage) => {
    setSelectedMessageForAction(null);
    setDraftText(msg.content);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={idID.common.back}
        >
          <ArrowLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text
            style={[styles.headerTitle, { color: theme.colors.textPrimary }]}
            numberOfLines={1}
          >
            {conversationTitle ?? idID.chat.headerTitle}
          </Text>
          <StatusPill status={connectionStatus} />
        </View>
      </View>

      {/* Connection State Warning */}
      {connectionStatus !== 'connected' ? (
        <View
          style={[
            styles.connBanner,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderBottomColor: theme.colors.warning,
            },
          ]}
        >
          <Text style={[styles.connBannerText, { color: theme.colors.warning }]}>
            {connectionStatus === 'reconnecting'
              ? idID.chat.connReconnecting
              : connectionStatus === 'connecting'
                ? idID.chat.connConnecting
                : idID.chat.connDisconnected}
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text style={[styles.errorText, { color: theme.colors.danger }]}>{error}</Text>
      ) : null}

      {historyError ? (
        <View
          style={[
            styles.errorBanner,
            {
              backgroundColor: theme.colors.dangerBg,
              borderColor: theme.colors.danger,
            },
          ]}
        >
          <Text style={[styles.errorText, { color: theme.colors.danger }]}>
            {historyError instanceof Error ? historyError.message : 'Riwayat gagal dimuat'}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={idID.common.retry}
            style={styles.retryButton}
            onPress={() => void refetchHistory()}
          >
            <Text style={[styles.retryButtonText, { color: theme.colors.danger }]}>
              {idID.common.retry}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Messages List */}
      {isLoadingInitial && messages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
            {idID.common.loading}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            return (
              <TouchableOpacity
                activeOpacity={0.85}
                onLongPress={() => setSelectedMessageForAction(item)}
                accessibilityRole="button"
                accessibilityLabel={`${isUser ? 'Pesan Anda' : 'Pesan Asisten'}: ${item.content}. Tekan lama untuk opsi salin atau ulangi.`}
                style={[
                  styles.messageContainer,
                  isUser ? styles.userContainer : styles.assistantContainer,
                ]}
              >
                {isUser ? (
                  // User Message: Smooth Bubble on Right
                  <View
                    style={[
                      styles.userBubble,
                      {
                        backgroundColor: theme.colors.primary,
                        borderColor: theme.colors.primary,
                      },
                    ]}
                  >
                    <Text style={styles.userMessageText}>{item.content}</Text>
                    <Text style={styles.userTimestamp}>
                      {new Date(item.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                ) : (
                  // Assistant Message: Full width without heavy bubble
                  <View style={styles.assistantMessageWrapper}>
                    <View style={styles.assistantHeaderRow}>
                      <View style={styles.assistantSparkleBadge}>
                        <Sparkles size={14} color={theme.colors.primary} />
                      </View>
                      <Text
                        style={[
                          styles.assistantNameText,
                          { color: theme.colors.textSecondary },
                        ]}
                      >
                        Asisten
                      </Text>
                      {typeof item.metadata?.['resolvedModel'] === 'string' ? (
                        <Text
                          style={[
                            styles.modelAttributionText,
                            {
                              color:
                                item.metadata['fallbackUsed'] === true
                                  ? theme.colors.warning
                                  : theme.colors.textMuted,
                            },
                          ]}
                        >
                          {idID.chat.answeredBy} {String(item.metadata['resolvedModel'])}
                          {item.metadata['fallbackUsed'] === true
                            ? ` ${idID.chat.fallbackUsed}`
                            : ''}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.assistantMarkdownBox}>
                      <MarkdownView
                        content={item.content || idID.chat.streamingThinking}
                        textColor={theme.colors.textPrimary}
                        onCopyNotice={(notice) => showToast(notice)}
                      />
                    </View>

                    {item.attachments && item.attachments.length > 0 ? (
                      <View style={styles.attachmentList}>
                        {item.attachments.map((att: MessageAttachment, idx: number) => (
                          <Text
                            key={idx}
                            style={[
                              styles.attachmentPill,
                              {
                                backgroundColor: theme.colors.surfaceElevated,
                                color: theme.colors.primary,
                              },
                            ]}
                          >
                            📎 {att.name || att.type}
                          </Text>
                        ))}
                      </View>
                    ) : null}

                    <Text style={[styles.assistantTimestamp, { color: theme.colors.textMuted }]}>
                      {new Date(item.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            !isStreaming ? (
              <View style={styles.emptyState}>
                <View
                  style={[
                    styles.emptySparkleCircle,
                    { backgroundColor: theme.colors.surfaceElevated },
                  ]}
                >
                  <Sparkles size={36} color={theme.colors.primary} />
                </View>
                <Text
                  style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}
                  accessibilityRole="header"
                >
                  {idID.chat.emptyTitle}
                </Text>
                <Text
                  style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}
                >
                  {idID.chat.emptySubtitle}
                </Text>

                {/* Sample Prompt Cards */}
                <View style={styles.samplePromptsContainer}>
                  {idID.chat.samplePrompts.map((item, idx) => (
                    <TouchableOpacity
                      key={idx}
                      accessibilityRole="button"
                      accessibilityLabel={`Contoh prompt: ${item.title}`}
                      style={[
                        styles.samplePromptCard,
                        {
                          backgroundColor: theme.colors.surface,
                          borderColor: theme.colors.surfaceBorder,
                        },
                      ]}
                      onPress={() => setDraftText(item.prompt)}
                    >
                      <Text
                        style={[
                          styles.samplePromptTitle,
                          { color: theme.colors.textPrimary },
                        ]}
                      >
                        {item.title}
                      </Text>
                      <Text
                        style={[
                          styles.samplePromptText,
                          { color: theme.colors.textMuted },
                        ]}
                        numberOfLines={2}
                      >
                        {item.prompt}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null
          }
          ListFooterComponent={
            isStreaming &&
            !messages.some((m) => m.id === useChatStore.getState().streamingMessageId) ? (
              <View style={styles.streamingIndicatorBox}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text
                  style={[
                    styles.streamingIndicatorText,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {idID.chat.streamingThinking}
                </Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Composer Area */}
      <View
        style={[
          styles.composerContainer,
          {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        {/* Model Notice Banner */}
        {modelNotice ? (
          <View
            style={[
              styles.noticeBanner,
              {
                backgroundColor: theme.colors.riskHighBg,
                borderColor: theme.colors.riskHigh,
              },
            ]}
          >
            <Text style={[styles.noticeText, { color: theme.colors.riskHigh }]}>
              ⚠️ {modelNotice}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.common.close}
              style={styles.noticeDismissBtn}
              onPress={clearModelNotice}
            >
              <X size={16} color={theme.colors.riskHigh} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Catalog Offline Notice */}
        {modelCatalogUnavailable && !modelNotice ? (
          <View
            style={[
              styles.offlineBannerRow,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.warning,
              },
            ]}
          >
            <Text style={[styles.offlineBannerText, { color: theme.colors.warning }]}>
              {idID.chat.catalogOffline}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.common.retry}
              style={styles.offlineRetryBtn}
              onPress={() => void loadCatalog()}
            >
              <Text style={[styles.offlineRetryText, { color: theme.colors.primary }]}>
                {idID.common.retry}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Chips Row: Mode & Model */}
        <View style={styles.chipsRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Ubah mode, saat ini ${MODE_LABELS[selectedMode]}`}
            style={[
              styles.chipButton,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
            onPress={() => {
              const nextIndex = (MODES.indexOf(selectedMode) + 1) % MODES.length;
              void setConversationMode(MODES[nextIndex]!);
            }}
          >
            <Text
              style={[styles.chipButtonText, { color: theme.colors.textPrimary }]}
            >
              ⚡ {MODE_LABELS[selectedMode]}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Pilih model, saat ini ${selectedModel}`}
            accessibilityState={{ disabled: modelCatalogUnavailable }}
            disabled={modelCatalogUnavailable}
            style={[
              styles.chipButton,
              styles.modelChipButton,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.surfaceBorder,
              },
              modelCatalogUnavailable && styles.chipDisabled,
            ]}
            onPress={() => setIsModelModalOpen(true)}
          >
            <Text
              style={[
                styles.chipButtonText,
                { color: theme.colors.textPrimary },
                modelCatalogUnavailable && { color: theme.colors.textMuted },
              ]}
              numberOfLines={1}
            >
              🧠{' '}
              {modelCatalogUnavailable
                ? 'Auto (Katalog offline)'
                : selectedModel === 'auto'
                  ? 'Auto (Disarankan)'
                  : selectedModel}
            </Text>
          </TouchableOpacity>

          {/* Run as Task CTA */}
          {draftText.trim() && activeProjectId ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.chat.runAsTask}
              disabled={createTask.isPending}
              style={[
                styles.chipButton,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.primary,
                },
              ]}
              onPress={() => void handleRunAsTask()}
            >
              <Text style={[styles.chipButtonText, { color: theme.colors.primary }]}>
                📋 {createTask.isPending ? idID.chat.runAsTaskRunning : idID.chat.runAsTask}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Text Input Row with Send / Stop buttons */}
        <View style={styles.inputControlsRow}>
          <TextInput
            accessibilityLabel={idID.chat.composerPlaceholder}
            style={[
              styles.textInput,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.surfaceBorder,
                color: theme.colors.textPrimary,
              },
            ]}
            value={draftText}
            onChangeText={setDraftText}
            placeholder={idID.chat.composerPlaceholder}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={4000}
          />

          {isStreaming ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.chat.stop}
              disabled={isCancelling}
              style={[
                styles.iconBtn,
                {
                  backgroundColor: theme.colors.dangerBg,
                  borderColor: theme.colors.danger,
                },
                isCancelling && styles.btnDisabled,
              ]}
              onPress={handleCancel}
            >
              <Square size={18} color={theme.colors.danger} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.chat.send}
              disabled={
                !draftText.trim() ||
                isSending ||
                connectionStatus !== 'connected'
              }
              style={[
                styles.iconBtn,
                {
                  backgroundColor:
                    !draftText.trim() ||
                    isSending ||
                    connectionStatus !== 'connected'
                      ? theme.colors.surfaceElevated
                      : theme.colors.primary,
                  borderColor: theme.colors.surfaceBorder,
                },
                (!draftText.trim() ||
                  isSending ||
                  connectionStatus !== 'connected') &&
                  styles.btnDisabled,
              ]}
              onPress={() => handleSend()}
            >
              <Send
                size={18}
                color={
                  !draftText.trim() ||
                  isSending ||
                  connectionStatus !== 'connected'
                    ? theme.colors.textMuted
                    : '#fff'
                }
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Long-Press Message Actions Modal */}
      <Modal
        visible={Boolean(selectedMessageForAction)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMessageForAction(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedMessageForAction(null)}
        >
          <View
            style={[
              styles.actionsModalCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            <Text
              style={[styles.actionsModalTitle, { color: theme.colors.textPrimary }]}
            >
              {idID.chat.messageActionsTitle}
            </Text>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.chat.copyMessage}
              style={styles.actionModalRow}
              onPress={() =>
                selectedMessageForAction && handleCopyMessage(selectedMessageForAction)
              }
            >
              <Copy size={18} color={theme.colors.primary} />
              <Text
                style={[
                  styles.actionModalText,
                  { color: theme.colors.textPrimary },
                ]}
              >
                {idID.chat.copyMessage}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.chat.retryMessage}
              style={styles.actionModalRow}
              onPress={() =>
                selectedMessageForAction && handleRetryMessage(selectedMessageForAction)
              }
            >
              <RotateCcw size={18} color={theme.colors.primary} />
              <Text
                style={[
                  styles.actionModalText,
                  { color: theme.colors.textPrimary },
                ]}
              >
                {idID.chat.retryMessage}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={idID.common.cancel}
              style={[
                styles.actionModalCancelBtn,
                { borderTopColor: theme.colors.surfaceBorder },
              ]}
              onPress={() => setSelectedMessageForAction(null)}
            >
              <Text
                style={[
                  styles.actionModalCancelText,
                  { color: theme.colors.textSecondary },
                ]}
              >
                {idID.common.cancel}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Model Selector Sheet */}
      <ModelSelectorModal
        visible={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    minHeight: 56,
  },
  backButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  headerTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  connBanner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  connBannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    fontSize: 12,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryButton: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 24,
  },
  messageContainer: {
    width: '100%',
    marginBottom: 16,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
    width: '100%',
  },
  userBubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
  },
  userMessageText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  userTimestamp: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  assistantMessageWrapper: {
    width: '100%',
    paddingVertical: 4,
  },
  assistantHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  assistantSparkleBadge: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  assistantNameText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modelAttributionText: {
    fontSize: 11,
    marginLeft: 4,
  },
  assistantMarkdownBox: {
    width: '100%',
  },
  assistantTimestamp: {
    fontSize: 10,
    marginTop: 6,
  },
  attachmentList: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  attachmentPill: {
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 8,
  },
  emptySparkleCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  samplePromptsContainer: {
    width: '100%',
    gap: 10,
  },
  samplePromptCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  samplePromptTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  samplePromptText: {
    fontSize: 12,
    lineHeight: 17,
  },
  streamingIndicatorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  streamingIndicatorText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  composerContainer: {
    borderTopWidth: 1,
    padding: 12,
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  noticeText: {
    fontSize: 12,
    flex: 1,
  },
  noticeDismissBtn: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  offlineBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  offlineBannerText: {
    fontSize: 12,
    flex: 1,
  },
  offlineRetryBtn: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  offlineRetryText: {
    fontSize: 12,
    fontWeight: '700',
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  chipButton: {
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modelChipButton: {
    maxWidth: 200,
  },
  chipDisabled: {
    opacity: 0.6,
  },
  chipButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inputControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textInput: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  actionsModalCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    elevation: 8,
  },
  actionsModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  actionModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 20,
  },
  actionModalText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionModalCancelBtn: {
    borderTopWidth: 1,
    marginTop: 8,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionModalCancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
