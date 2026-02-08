/**
 * ChatApp - React-based chat interface using ChatScope UI Kit
 * Connected to WebLLM engine via fetchRouter
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  TypingIndicator,
  Avatar,
  ConversationHeader,
  InfoButton,
  VoiceCallButton,
  VideoCallButton,
} from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import { createEngine, getEngine, getAvailableModels, getCurrentModelId } from './engine';
import type { InitProgressReport } from './engine';

interface ChatMessage {
  message: string;
  sender: 'user' | 'assistant';
  direction: 'incoming' | 'outgoing';
  position: 'single' | 'first' | 'normal' | 'last';
}

export function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState('Initializing...');
  const [modelName, setModelName] = useState('');
  const [engineReady, setEngineReady] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize WebLLM engine on mount
  useEffect(() => {
    initializeEngine();
  }, []);

  const initializeEngine = async () => {
    try {
      setIsLoading(true);
      setLoadingText('Checking WebGPU support...');

      // Check WebGPU
      const nav = navigator as any;
      if (!nav.gpu) {
        setLoadingText('⚠️ WebGPU not supported in this browser');
        return;
      }

      const adapter = await nav.gpu.requestAdapter();
      if (!adapter) {
        setLoadingText('⚠️ WebGPU not available');
        return;
      }

      // Load default model
      const defaultModel = 'SmolLM2-360M-Instruct-q4f32_1-MLC';
      setModelName(defaultModel);
      
      const onProgress = (report: InitProgressReport) => {
        setLoadingProgress(report.progress * 100);
        setLoadingText(report.text);
      };

      const engine = await createEngine(defaultModel, onProgress);
      
      // Install fetch router to intercept API calls
      const { installFetchRouter } = await import('./fetchRouter');
      installFetchRouter(engine);
      
      setEngineReady(true);
      setIsLoading(false);
      
      // Add welcome message
      setMessages([{
        message: "Hello! I'm your AI assistant powered by WebLLM. I run entirely in your browser using WebGPU. How can I help you today?",
        sender: 'assistant',
        direction: 'incoming',
        position: 'single',
      }]);
    } catch (error) {
      console.error('Engine initialization error:', error);
      setLoadingText(`Error: ${(error as Error).message}`);
    }
  };

  const handleSend = async (message: string) => {
    if (!message.trim() || !engineReady) return;

    const userMessage: ChatMessage = {
      message: message.trim(),
      sender: 'user',
      direction: 'outgoing',
      position: 'single',
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    try {
      // Use the OpenAI-compatible API via fetchRouter
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: getCurrentModelId() || 'webllm',
          messages: [{ role: 'user', content: message }],
          stream: true,
          stream_options: { include_usage: true },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      // Create a placeholder message for streaming
      const assistantMessage: ChatMessage = {
        message: '',
        sender: 'assistant',
        direction: 'incoming',
        position: 'single',
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      const assistantMsgIndex = messages.length + 1;

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const payload = trimmed.slice(6);
          if (payload === '[DONE]') continue;

          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta?.content ?? '';
            fullText += delta;

            // Update the message
            setMessages(prev => {
              const newMessages = [...prev];
              newMessages[assistantMsgIndex] = {
                ...newMessages[assistantMsgIndex],
                message: fullText,
              };
              return newMessages;
            });
          } catch {
            // Skip malformed chunks
          }
        }
      }

      setIsTyping(false);
    } catch (error) {
      console.error('Send error:', error);
      const errorMessage: ChatMessage = {
        message: `Error: ${(error as Error).message}`,
        sender: 'assistant',
        direction: 'incoming',
        position: 'single',
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsTyping(false);
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: '20px',
        textAlign: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
      }}>
        <div style={{ fontSize: '4rem', marginBottom: '20px' }}>🧠</div>
        <h2 style={{ margin: '10px 0' }}>WebLLM</h2>
        <p style={{ marginBottom: '20px', opacity: 0.9 }}>{loadingText}</p>
        <div style={{
          width: '300px',
          height: '8px',
          background: 'rgba(255,255,255,0.2)',
          borderRadius: '4px',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${loadingProgress}%`,
            height: '100%',
            background: 'white',
            borderRadius: '4px',
            transition: 'width 0.3s ease',
          }} />
        </div>
        <p style={{ marginTop: '10px', fontSize: '0.9rem', opacity: 0.7 }}>
          {Math.round(loadingProgress)}%
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: '100vh' }}>
      <MainContainer>
        <ChatContainer>
          <ConversationHeader>
            <Avatar src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧠%3C/text%3E%3C/svg%3E" name="WebLLM" />
            <ConversationHeader.Content
              userName="WebLLM Assistant"
              info={modelName}
            />
            <ConversationHeader.Actions>
              <InfoButton />
            </ConversationHeader.Actions>
          </ConversationHeader>
          <MessageList
            typingIndicator={isTyping ? <TypingIndicator content="AI is thinking..." /> : null}
          >
            {messages.map((msg, index) => (
              <Message
                key={index}
                model={{
                  message: msg.message,
                  sender: msg.sender,
                  direction: msg.direction,
                  position: msg.position,
                }}
              >
                {msg.sender === 'assistant' && (
                  <Avatar src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧠%3C/text%3E%3C/svg%3E" name="AI" />
                )}
              </Message>
            ))}
            <div ref={messagesEndRef} />
          </MessageList>
          <MessageInput
            placeholder="Type your message here..."
            value={inputValue}
            onChange={(val) => setInputValue(val)}
            onSend={handleSend}
            disabled={!engineReady}
            attachButton={false}
          />
        </ChatContainer>
      </MainContainer>
    </div>
  );
}
