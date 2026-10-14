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
  const { data: initialMessages, isLoading: isLoadingInitial, error: historyError } = useMessages(conversationId);
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
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>{conversationTitle ?? 'Chat'}</Text>
          <StatusPill status={connectionStatus} />
        </View>
      </View>
      {error || historyError ? <Text style={styles.errorText}>{error ?? (historyError instanceof Error ? historyError.message : 'Unable to load history')}</Text> : null}

      {isLoadingInitial && messages.length === 0 ? (
        <View style={styles.loadingContainer}><ActivityIndicator color={theme.colors.primary} /></View>
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
              <View style={[styles.bubbleContainer, isUser ? styles.userAlign : styles.assistantAlign]}>
                <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
                  <Text style={[styles.bubbleText, isUser ? styles.userText : styles.assistantText]}>{item.content}</Text>
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
          <TouchableOpacity onPress={() => setSelectedMode(selectedMode === 'auto' ? 'fast' : selectedMode === 'fast' ? 'coding' : selectedMode === 'coding' ? 'complex' : selectedMode === 'complex' ? 'research' : 'auto')}><Text style={styles.selectorButton}>Change</Text></TouchableOpacity>
          <Text style={styles.selectorLabel}>Model: {selectedModel}</Text>
          {models.length > 0 ? <TouchableOpacity onPress={() => setSelectedModel(selectedModel === 'auto' ? models[0]!.id : 'auto')}><Text style={styles.selectorButton}>Change</Text></TouchableOpacity> : null}
        </View>
        <View style={styles.inputControlsRow}>
          <TextInput style={styles.textInput} value={draftText} onChangeText={setDraftText} placeholder="Ketik pesan untuk asisten..." placeholderTextColor={theme.colors.textMuted} multiline maxLength={4000} />
          <TouchableOpacity style={[styles.sendBtn, (!draftText.trim() || isStreaming || isSending || isCancelling || connectionStatus !== 'connected') && styles.sendBtnDisabled]} onPress={handleSend} disabled={!draftText.trim() || isStreaming || isSending || isCancelling || connectionStatus !== 'connected'}><Text style={styles.sendBtnText}>↑</Text></TouchableOpacity>
        </View>
        {isStreaming ? <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}><Text style={styles.cancelButtonText}>Stop</Text></TouchableOpacity> : null}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.surfaceBorder },
  backButton: { marginRight: theme.spacing.sm },
  backButtonText: { color: theme.colors.primary, fontSize: 28 },
  headerTitleContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: '600' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: theme.colors.danger, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, fontSize: 12 },
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
  timestamp: { color: theme.colors.textMuted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  attachmentList: { marginTop: 4 },
  attachmentPill: { fontSize: 11, color: theme.colors.primary, backgroundColor: theme.colors.surfaceElevated, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', marginTop: 2 },
  streamingIndicatorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.spacing.xs },
  streamingLabel: { color: theme.colors.textMuted, fontSize: 11 },
  cancelButton: { backgroundColor: theme.colors.dangerBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: theme.colors.danger },
  cancelButtonText: { color: theme.colors.danger, fontSize: 11, fontWeight: '600' },
  inputBar: { backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.surfaceBorder, padding: theme.spacing.sm },
  inputControlsRow: { flexDirection: 'row', alignItems: 'center' },
  selectorLabel: { color: theme.colors.textMuted, fontSize: 11, marginRight: theme.spacing.xs },
  selectorButton: { color: theme.colors.primary, fontSize: 11, marginRight: theme.spacing.sm },
  textInput: { flex: 1, backgroundColor: theme.colors.surfaceElevated, color: theme.colors.textPrimary, paddingHorizontal: theme.spacing.md, paddingVertical: 8, borderRadius: theme.borderRadius.full, maxHeight: 100, fontSize: 14 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', marginLeft: theme.spacing.xs },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
