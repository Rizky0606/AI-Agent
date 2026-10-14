import React, { useEffect, useRef } from 'react';
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
import type { MessageAttachment } from '../api/types.ts';
import { defaultApiClient } from '../api/client.ts';
import { StatusPill } from '../components/StatusPill.tsx';
import { theme } from '../components/Theme.ts';
import { useMessages } from '../hooks/use-queries.ts';
import { ChatWebSocketClient } from '../services/chat-websocket.ts';
import { useChatStore } from '../state/chat-store.ts';

export interface ChatScreenProps {
  conversationId: string;
  conversationTitle?: string | undefined;
  onBack: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  conversationId,
  conversationTitle,
  onBack,
}) => {
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
    models,
    selectedModel,
    selectedMode,
    setModels,
    setSelectedModel,
    setSelectedMode,
    connectionStatus,
  } = useChatStore();
  const { data: initialMessages, isLoading: isLoadingInitial, error: historyError, refetch: refetchHistory } = useMessages(conversationId);
  useEffect(() => {
    void defaultApiClient.listModels().then((catalog) => setModels(catalog.models)).catch(() => setModels([]));
  }, [setModels]);
  const wsClientRef = useRef<ChatWebSocketClient | null>(null);
  const flatListRef = useRef<FlatList>(null);

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
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {historyError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{historyError instanceof Error ? historyError.message : 'Riwayat gagal dimuat'}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={() => void refetchHistory()}><Text style={styles.retryButtonText}>Coba lagi</Text></TouchableOpacity>
        </View>
      ) : null}

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
        <View style={styles.inputControlsRow}>
          <Text style={styles.selectorLabel}>Mode: {selectedMode}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Change mode, currently ${selectedMode}`} style={styles.selectorControl} onPress={() => setSelectedMode(selectedMode === 'auto' ? 'fast' : selectedMode === 'fast' ? 'coding' : selectedMode === 'coding' ? 'complex' : selectedMode === 'complex' ? 'research' : 'auto')}><Text style={styles.selectorButton}>Change</Text></TouchableOpacity>
          <Text style={styles.selectorLabel}>Model: {selectedModel}</Text>
          {models.length > 0 ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Change model, currently ${selectedModel}`} style={styles.selectorControl} onPress={() => setSelectedModel(selectedModel === 'auto' ? models[0]!.id : 'auto')}><Text style={styles.selectorButton}>Change</Text></TouchableOpacity> : null}
        </View>
        <View style={styles.inputControlsRow}>
          <TextInput accessibilityLabel="Message" style={styles.textInput} value={draftText} onChangeText={setDraftText} placeholder="Ketik pesan untuk asisten..." placeholderTextColor={theme.colors.textMuted} multiline maxLength={4000} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Send message" style={[styles.sendBtn, (!draftText.trim() || isStreaming || isSending || isCancelling || connectionStatus !== 'connected') && styles.sendBtnDisabled]} onPress={handleSend} disabled={!draftText.trim() || isStreaming || isSending || isCancelling || connectionStatus !== 'connected'}><Text style={styles.sendBtnText}>↑</Text></TouchableOpacity>
        </View>
        {isStreaming ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Stop response" accessibilityState={{ disabled: isCancelling }} disabled={isCancelling} style={[styles.cancelButton, isCancelling && styles.sendBtnDisabled]} onPress={handleCancel}><Text style={styles.cancelButtonText}>{isCancelling ? 'Stopping…' : 'Stop'}</Text></TouchableOpacity> : null}
      </View>
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
  attachmentList: { marginTop: 4 },
  attachmentPill: { fontSize: 11, color: theme.colors.primary, backgroundColor: theme.colors.surfaceElevated, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', marginTop: 2 },
  streamingIndicatorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.spacing.xs },
  streamingLabel: { color: theme.colors.textMuted, fontSize: 11 },
  cancelButton: { backgroundColor: theme.colors.dangerBg, minHeight: theme.controls.minTouchTarget, justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.danger },
  cancelButtonText: { color: theme.colors.danger, ...theme.typography.body, fontWeight: '600' },
  inputBar: { backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.surfaceBorder, padding: theme.spacing.sm },
  inputControlsRow: { flexDirection: 'row', alignItems: 'center' },
  selectorLabel: { color: theme.colors.textMuted, ...theme.typography.caption, marginRight: theme.spacing.xs },
  selectorControl: { minHeight: theme.controls.minTouchTarget, justifyContent: 'center' },
  selectorButton: { color: theme.colors.primary, ...theme.typography.caption, marginRight: theme.spacing.sm },
  textInput: { flex: 1, backgroundColor: theme.colors.surfaceElevated, color: theme.colors.textPrimary, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.borderRadius.full, maxHeight: 100, ...theme.typography.body },
  sendBtn: { width: theme.controls.minTouchTarget, height: theme.controls.minTouchTarget, borderRadius: theme.controls.minTouchTarget / 2, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', marginLeft: theme.spacing.xs },
  sendBtnDisabled: { backgroundColor: theme.colors.surfaceElevated, opacity: 0.6 },
  sendBtnText: { color: theme.colors.textPrimary, fontSize: 20, fontWeight: '700' },
});
