import { useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

//////////////////////////////
// Types
//////////////////////////////

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

//////////////////////////////
// Shared Initial Prompt
//////////////////////////////

const INITIAL_PROMPT =
  "Hi - I’m here to help you organize your health concerns before speaking with a clinician.\n\nWhat are your health concerns today?";

//////////////////////////////
// Screen
//////////////////////////////

export default function ChatGPTIntakeScreen() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: INITIAL_PROMPT },
  ]);

  const [input, setInput] = useState('');
  const [finished, setFinished] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  //////////////////////////
  // Send Message
  //////////////////////////

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
    };

    // For now → mock assistant response
    const assistantMessage: Message = {
      role: 'assistant',
      content:
        "Thank you for sharing. Could you describe when these symptoms started and how severe they feel?",
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput('');
  };

  //////////////////////////
  // Finish Intake
  //////////////////////////

  const handleFinish = () => {
    setFinished(true);

    // Prototype summary (LLM later)
    const combined = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join(' ');

    setSummary(
      `Summary Assessment:\n\nBased on what you shared: "${combined}".\n\nThis information can help guide a clinical conversation.`
    );
  };

  //////////////////////////
  // UI
  //////////////////////////

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ThemedView style={styles.container}>
        
        {/* Chat Area */}
        <ScrollView style={styles.chatArea}>
          {messages.map((msg, index) => (
            <View
              key={index}
              style={[
                styles.messageBubble,
                msg.role === 'user'
                  ? styles.userBubble
                  : styles.assistantBubble,
              ]}
            >
              <ThemedText>{msg.content}</ThemedText>
            </View>
          ))}

          {/* Summary Panel */}
          {finished && summary && (
            <View style={styles.summaryPanel}>
              <ThemedText style={{ fontWeight: '600' }}>
                Intake Summary
              </ThemedText>
              <ThemedText>{summary}</ThemedText>
            </View>
          )}
        </ScrollView>

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Type your response..."
            multiline
          />

          <Pressable style={styles.sendBtn} onPress={handleSend}>
            <ThemedText style={{ color: '#FFF' }}>
              Send
            </ThemedText>
          </Pressable>
        </View>

        {/* Finish Button */}
        <Pressable style={styles.finishBtn} onPress={handleFinish}>
          <ThemedText style={{ color: '#FFF', fontWeight: '600' }}>
            Finish Intake
          </ThemedText>
        </Pressable>

      </ThemedView>
    </KeyboardAvoidingView>
  );
}

//////////////////////////////
// Styles
//////////////////////////////

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },

  chatArea: {
    flex: 1,
    marginBottom: 12,
  },

  messageBubble: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    maxWidth: '85%',
  },

  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#DBEAFE',
  },

  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3F4F6',
  },

  inputBar: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
  },

  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    minHeight: 50,
  },

  sendBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },

  finishBtn: {
    marginTop: 10,
    backgroundColor: '#10B981',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },

  summaryPanel: {
    marginTop: 16,
    padding: 14,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B981',
  },
});
