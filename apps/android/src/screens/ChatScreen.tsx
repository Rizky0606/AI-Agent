import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { ChatMode, MessageAttachment } from '../api/types.ts';
import { ModelSelectorModal } from '../components/ModelSelectorModal.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { theme } from '../components/Theme.ts';
import { useCreateTask, useMessages, useTasks } from '../hooks/use-queries.ts';
import { useUiStore } from '../state/ui-store.ts';
import { ChatWebSocketClient } from '../services/chat-websocket.ts';
import { TaskEventsWebSocketClient } from '../services/task-events-websocket.ts';
import { useChatStore } from '../state/chat-store.ts';

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
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
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
  const { data: initialMessages, isLoading: isLoadingInitial, error: historyError, refetch: refetchHistory } = useMessages(conversationId);

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

  // Live task progress: the events socket is user-scoped (no taskId), so any event belonging to a
  // task in this conversation refetches the list. The id set lives in a ref so the socket is not
  // torn down and rebuilt on every progress update.
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
  const handleSend = () => {
    const trimmed = draftText.trim();
    if (!trimmed || !wsClientRef.current) return;
    beginSend();
    try {
      wsClientRef.current.sendMessage({
        content: trimmed,
        model: selectedModel === 'auto' ? undefined : selectedModel,
        mode: selectedMode,
      });
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
      await createTask.mutateAsync({ projectId: activeProjectId, kind: 'generic_task', payload: { prompt: instruction }, conversationId });
      await refetchConversationTasks();
    } catch {
      // useCreateTask surfaces the failure through its own error state.
    }
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={styles.backButtonText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>{conversationTitle ?? 'Chat'}</Text>
          <StatusPill status={connectionStatus} />
        </View>
      </View>
      {connectionStatus !== 'connected' ? (
        <View style={styles.connBanner}>
          <Text style={styles.connBannerText}>
            {connectionStatus === 'reconnecting' ? 'Koneksi terputus. Menyambung ulang…' : connectionStatus === 'connecting' ? 'Menyambungkan…' : 'Tidak terhubung. Pesan tidak dapat dikirim.'}
          </Text>
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {historyError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{historyError instanceof Error ? historyError.message : 'Riwayat gagal dimuat'}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={() => void refetchHistory()}><Text style={styles.retryButtonText}>Coba lagi</Text></TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.chatTasks} accessibilityLabel="Tasks from this conversation">
        <View style={styles.chatTasksHead}>
          <Text style={styles.chatTasksTitle}>Tasks from this conversation</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Run draft as task"
            accessibilityState={{ disabled: createTask.isPending || !draftText.trim() || !activeProjectId }}
            disabled={createTask.isPending || !draftText.trim() || !activeProjectId}
            onPress={() => void handleRunAsTask()}
          >
            <Text style={[styles.chatTasksAction, (createTask.isPending || !draftText.trim() || !activeProjectId) && styles.chatTasksActionDisabled]}>{createTask.isPending ? 'Mengirim…' : 'Jalankan sebagai tugas'}</Text>
          </TouchableOpacity>
        </View>
        {!activeProjectId ? <Text style={styles.chatTasksEmpty}>Pilih project untuk menjalankan tugas dari chat.</Text> : null}
        {conversationTasks && conversationTasks.length > 0 ? (
          <View style={styles.chatTaskList}>
            {conversationTasks.map((task) => (
              <View key={task.id} style={styles.chatTaskRow}>
                <Text style={styles.chatTaskKind}>{task.kind}</Text>
                <Text style={styles.chatTaskProgress}>{task.progress}%</Text>
                <Text style={styles.chatTaskStatus}>{task.status}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.chatTasksEmpty}>Belum ada tugas dari percakapan ini.</Text>
        )}
      </View>

      {isLoadingInitial && messages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.loadingText}>Memuat riwayat…</Text>
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
              <View
                style={[styles.bubbleContainer, isUser ? styles.userAlign : styles.assistantAlign]}
                accessibilityLabel={`${isUser ? 'You' : 'Assistant'}: ${item.content}`}
              >
                <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
                  <Text style={styles.bubbleRole}>{isUser ? 'You' : 'Assistant'}</Text>
                  <Text style={[styles.bubbleText, isUser ? styles.userText : styles.assistantText]}>{item.content || 'Thinking…'}</Text>
                  {typeof item.metadata?.['resolvedModel'] === 'string' ? (
                    <Text
                      style={[
                        styles.bubbleModel,
                        item.metadata['fallbackUsed'] === true && styles.bubbleModelFallback,
                      ]}
                    >
                      Dijawab oleh {String(item.metadata['resolvedModel'])}
                      {item.metadata['fallbackUsed'] === true ? ' (fallback)' : ''}
                    </Text>
                  ) : null}
                  {item.attachments && item.attachments.length > 0 ? (
                    <View style={styles.attachmentList}>
                      {item.attachments.map((att: MessageAttachment, idx: number) => (
                        <Text key={idx} style={styles.attachmentPill}>📎 {att.name || att.type}</Text>
                      ))}
                    </View>
                  ) : null}
                  <Text style={styles.timestamp}>{new Date(item.createdAt).toLocaleTimeString()}</Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={!isStreaming ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyMark}>✦</Text>
              <Text style={styles.emptyTitle}>Mulai percakapan</Text>
              <Text style={styles.emptySubtitle}>Tanyakan apa saja. Pesan Anda tersimpan lintas perangkat.</Text>
            </View>
          ) : null}
          ListFooterComponent={isStreaming && !messages.some((message) => message.id === useChatStore.getState().streamingMessageId) ? (
            <View style={[styles.bubbleContainer, styles.assistantAlign]}>
              <View style={[styles.bubble, styles.assistantBubble]}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <View style={styles.streamingIndicatorRow}>
                  <Text style={styles.streamingLabel}>Thinking…</Text>
                </View>
              </View>
            </View>
          ) : null}
        />
      )}

      <View style={styles.inputBar}>
        {modelNotice ? (
          <View style={styles.noticeBanner}>
            <Text style={styles.noticeText}>⚠️ {modelNotice}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Tutup pemberitahuan"
              style={styles.noticeDismissBtn}
              onPress={clearModelNotice}
            >
              <Text style={styles.noticeDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {modelCatalogUnavailable && !modelNotice ? (
          <View style={styles.offlineBannerRow}>
            <Text style={styles.offlineBannerText}>Katalog 503 (offline). Auto tetap aktif.</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Coba lagi muat katalog"
              style={styles.offlineRetryBtn}
              onPress={() => void loadCatalog()}
            >
              <Text style={styles.offlineRetryText}>Coba lagi</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.chipsRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Ubah mode, saat ini ${MODE_LABELS[selectedMode]}`}
            style={styles.chipButton}
            onPress={() => {
              const nextIndex = (MODES.indexOf(selectedMode) + 1) % MODES.length;
              void setConversationMode(MODES[nextIndex]!);
            }}
          >
            <Text style={styles.chipButtonText}>⚡ {MODE_LABELS[selectedMode]}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Pilih model, saat ini ${selectedModel}`}
            accessibilityState={{ disabled: modelCatalogUnavailable }}
            disabled={modelCatalogUnavailable}
            style={[styles.chipButton, styles.modelChipButton, modelCatalogUnavailable && styles.chipDisabled]}
            onPress={() => setIsModelModalOpen(true)}
          >
            <Text style={[styles.chipButtonText, modelCatalogUnavailable && styles.chipTextDisabled]} numberOfLines={1}>
              🧠 {modelCatalogUnavailable ? 'Auto (Katalog offline)' : selectedModel === 'auto' ? 'Auto (Disarankan)' : selectedModel}
            </Text>
          </TouchableOpacity>

          {modelCatalogUnavailable ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Coba lagi memuat katalog"
              style={styles.chipRetryButton}
              onPress={() => void loadCatalog()}
            >
              <Text style={styles.chipRetryButtonText}>Coba lagi</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.inputControlsRow}>
          <TextInput
            accessibilityLabel="Message"
            style={styles.textInput}
            value={draftText}
            onChangeText={setDraftText}
            placeholder="Ketik pesan untuk asisten..."
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={4000}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Send message"
            style={[
              styles.sendBtn,
              (!draftText.trim() || isStreaming || isSending || isCancelling || connectionStatus !== 'connected') &&
                styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!draftText.trim() || isStreaming || isSending || isCancelling || connectionStatus !== 'connected'}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
        {isStreaming ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Stop response"
            accessibilityState={{ disabled: isCancelling }}
            disabled={isCancelling}
            style={[styles.cancelButton, isCancelling && styles.sendBtnDisabled]}
            onPress={handleCancel}
          >
            <Text style={styles.cancelButtonText}>{isCancelling ? 'Stopping…' : 'Stop'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ModelSelectorModal
        visible={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.surfaceBorder },
  backButton: { width: theme.controls.minTouchTarget, height: theme.controls.minTouchTarget, justifyContent: 'center', alignItems: 'center', marginRight: theme.spacing.sm },
  backButtonText: { color: theme.colors.primary, fontSize: 28 },
  headerTitleContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: theme.colors.textPrimary, ...theme.typography.bodyLarge, fontWeight: '600' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  connBanner: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.surfaceElevated, borderBottomWidth: 1, borderBottomColor: theme.colors.warning },
  connBannerText: { color: theme.colors.warning, ...theme.typography.caption, fontWeight: '600' },
  errorText: { color: theme.colors.danger, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, fontSize: 12 },
  loadingText: { color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.sm },
  errorBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, marginHorizontal: theme.spacing.md, marginTop: theme.spacing.sm, padding: theme.spacing.sm, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerBg },
  retryButton: { minHeight: theme.controls.minTouchTarget, justifyContent: 'center', paddingHorizontal: theme.spacing.md },
  retryButtonText: { color: theme.colors.danger, ...theme.typography.body, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingVertical: theme.spacing.xxl, paddingHorizontal: theme.spacing.xl },
  emptyMark: { color: theme.colors.primary, fontSize: 32, marginBottom: theme.spacing.sm },
  emptyTitle: { color: theme.colors.textPrimary, ...theme.typography.title, marginBottom: theme.spacing.xs },
  emptySubtitle: { color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' },
  messageList: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
  bubbleContainer: { width: '100%', marginBottom: theme.spacing.sm },
  userAlign: { alignItems: 'flex-end' },
  assistantAlign: { alignItems: 'flex-start' },
  bubble: { maxWidth: '85%', padding: theme.spacing.sm, borderRadius: theme.borderRadius.lg },
  userBubble: { backgroundColor: theme.colors.primary },
  assistantBubble: { backgroundColor: theme.colors.surface },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  userText: { color: '#fff' },
  assistantText: { color: theme.colors.textPrimary },
  bubbleRole: { color: theme.colors.textMuted, ...theme.typography.caption, fontWeight: '600', marginBottom: 2 },
  timestamp: { color: theme.colors.textMuted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  bubbleModel: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  bubbleModelFallback: { color: theme.colors.warning, fontWeight: '600' },
  chatTasks: { backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.surfaceBorder, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  chatTasksHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chatTasksTitle: { color: theme.colors.textMuted, ...theme.typography.caption, fontWeight: '600' },
  chatTasksAction: { color: theme.colors.primary, ...theme.typography.caption, fontWeight: '700', minHeight: theme.controls.minTouchTarget },
  chatTasksActionDisabled: { color: theme.colors.textMuted, opacity: 0.6 },
  chatTasksEmpty: { color: theme.colors.textMuted, fontSize: 12, marginTop: theme.spacing.xs },
  chatTaskList: { marginTop: theme.spacing.xs },
  chatTaskRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 2 },
  chatTaskKind: { color: theme.colors.textPrimary, fontSize: 12, flex: 1 },
  chatTaskProgress: { color: theme.colors.textSecondary, fontSize: 12 },
  chatTaskStatus: { color: theme.colors.textMuted, fontSize: 12, textTransform: 'capitalize' },
  attachmentList: { marginTop: 4 },
  attachmentPill: { fontSize: 11, color: theme.colors.primary, backgroundColor: theme.colors.surfaceElevated, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', marginTop: 2 },
  streamingIndicatorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.spacing.xs },
  streamingLabel: { color: theme.colors.textMuted, fontSize: 11 },
  cancelButton: { backgroundColor: theme.colors.dangerBg, minHeight: theme.controls.minTouchTarget, justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.danger, marginTop: theme.spacing.xs },
  cancelButtonText: { color: theme.colors.danger, ...theme.typography.body, fontWeight: '600' },
  inputBar: { backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.surfaceBorder, padding: theme.spacing.sm },
  noticeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#332b00', borderColor: theme.colors.warning, borderWidth: 1, borderRadius: theme.borderRadius.sm, paddingHorizontal: theme.spacing.sm, paddingVertical: 6, marginBottom: theme.spacing.xs },
  noticeText: { color: theme.colors.warning, fontSize: 12, flex: 1 },
  noticeDismissBtn: { width: theme.controls.minTouchTarget, height: theme.controls.minTouchTarget, justifyContent: 'center', alignItems: 'center' },
  noticeDismissText: { color: theme.colors.warning, fontSize: 16, fontWeight: '700' },
  offlineBannerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#2d1a1a', borderColor: theme.colors.danger, borderWidth: 1, borderRadius: theme.borderRadius.sm, paddingHorizontal: theme.spacing.sm, paddingVertical: 4, marginBottom: theme.spacing.xs },
  offlineBannerText: { color: '#ffb3b3', fontSize: 12, flex: 1 },
  offlineRetryBtn: { minHeight: 36, paddingHorizontal: theme.spacing.sm, justifyContent: 'center' },
  offlineRetryText: { color: '#ff8080', fontSize: 12, fontWeight: '700' },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, marginBottom: theme.spacing.xs, flexWrap: 'wrap' },
  chipButton: { minHeight: theme.controls.minTouchTarget, paddingHorizontal: theme.spacing.sm, paddingVertical: 6, borderRadius: theme.borderRadius.full, backgroundColor: theme.colors.surfaceElevated, borderWidth: 1, borderColor: theme.colors.surfaceBorder, justifyContent: 'center', alignItems: 'center' },
  modelChipButton: { flexShrink: 1, maxWidth: 220 },
  chipDisabled: { opacity: 0.6 },
  chipButtonText: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600' },
  chipTextDisabled: { color: theme.colors.textMuted },
  chipRetryButton: { minHeight: theme.controls.minTouchTarget, paddingHorizontal: theme.spacing.sm, justifyContent: 'center', alignItems: 'center' },
  chipRetryButtonText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  inputControlsRow: { flexDirection: 'row', alignItems: 'center' },
  textInput: { flex: 1, backgroundColor: theme.colors.surfaceElevated, color: theme.colors.textPrimary, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.borderRadius.full, maxHeight: 100, ...theme.typography.body },
  sendBtn: { width: theme.controls.minTouchTarget, height: theme.controls.minTouchTarget, borderRadius: theme.controls.minTouchTarget / 2, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', marginLeft: theme.spacing.xs },
  sendBtnDisabled: { backgroundColor: theme.colors.surfaceElevated, opacity: 0.6 },
  sendBtnText: { color: theme.colors.textPrimary, fontSize: 20, fontWeight: '700' },
});
