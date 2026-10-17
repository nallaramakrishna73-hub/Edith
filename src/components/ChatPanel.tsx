import React, { useState, useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble.tsx';
import { ChatInput } from './ChatInput.tsx';
import { LoadingIndicator } from './LoadingIndicator.tsx';
import { ErrorMessage } from './ErrorMessage.tsx';
import { AIOrb } from './AIOrb.tsx';
import { api, ApiClientError } from '../services/api.ts';
import { MessageItem } from '../types/api.ts';

interface ChatPanelProps {
  conversationId?: string | null;
  onConversationCreated?: (newId: string) => void;
  initialPrompt?: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  conversationId: propConversationId,
  onConversationCreated,
  initialPrompt = '',
}) => {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState(initialPrompt);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [activeConvId, setActiveConvId] = useState<string | null>(propConversationId || null);
  const [orbState, setOrbState] = useState<'idle' | 'thinking' | 'error'>('idle');

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync prop change
  useEffect(() => {
    setActiveConvId(propConversationId || null);
  }, [propConversationId]);

  // If initialPrompt provided, fill input
  useEffect(() => {
    if (initialPrompt) {
      setInputText(initialPrompt);
    }
  }, [initialPrompt]);

  // Load conversation messages if conversationId is set
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }

    let isMounted = true;
    const loadConversation = async () => {
      try {
        const data = await api.getConversation(activeConvId);
        if (isMounted) {
          setMessages(data.messages);
          setError(null);
        }
      } catch (err: unknown) {
        if (isMounted) {
          if (err instanceof ApiClientError) {
            setError({ code: err.code, message: err.message });
          } else {
            setError({ code: 'LOAD_ERROR', message: 'Failed to load conversation messages.' });
          }
          setOrbState('error');
        }
      }
    };

    loadConversation();

    return () => {
      isMounted = false;
    };
  }, [activeConvId]);

  // Auto-scroll to bottom on message updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, error]);

  const handleSend = async (messageToSend?: string) => {
    const text = (messageToSend !== undefined ? messageToSend : inputText).trim();
    if (!text || isLoading) return;

    // Reset error state
    setError(null);
    setLastFailedMessage(null);

    // Optimistic user message
    const tempUserMessage: MessageItem = {
      id: Date.now(),
      conversation_id: activeConvId || 'pending',
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMessage]);
    setInputText('');
    setIsLoading(true);
    setOrbState('thinking');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await api.sendMessage(text, activeConvId, 'text', controller.signal);

      const assistantMessage: MessageItem = {
        id: Date.now() + 1,
        conversation_id: response.conversation_id,
        role: 'assistant',
        content: response.reply,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setOrbState('idle');

      // If this was a new conversation, update state and URL
      if (!activeConvId && response.conversation_id) {
        setActiveConvId(response.conversation_id);
        onConversationCreated?.(response.conversation_id);
      }
    } catch (err: unknown) {
      setOrbState('error');
      // Restore draft text so user does not lose message
      setInputText(text);
      setLastFailedMessage(text);

      if (err instanceof ApiClientError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: 'NETWORK_ERROR',
          message: 'Unable to communicate with EDITH. Verify backend connectivity.',
        });
      }

      // Remove the optimistic user message from list on failure so state reflects only persisted exchanges
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setOrbState('idle');
  };

  const handleRetry = () => {
    if (lastFailedMessage) {
      handleSend(lastFailedMessage);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto w-full px-3 md:px-6 py-4">
      {/* Messages Thread Container */}
      <div
        role="region"
        aria-label="Conversation Thread"
        aria-live="polite"
        className="flex-1 overflow-y-auto pr-2 min-h-0 space-y-4"
      >
        {messages.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 select-none">
            <AIOrb size="md" state={orbState} showStatusLabel />

            <div className="mt-6 max-w-md">
              <h2 className="text-xl font-bold font-['Orbitron',sans-serif] tracking-wider text-white">
                EDITH IS READY
              </h2>
              <p className="mt-2 text-xs md:text-sm text-[#8FA3BF] leading-relaxed">
                Enhanced Digital Intelligence &amp; Tactical Helper. Ask complex
                programming questions, request algorithm explanations, or debug
                code.
              </p>
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-2 max-w-lg">
              <button
                onClick={() => handleSend('Explain Python functions and recursion with clean examples.')}
                className="px-3 py-1.5 rounded-lg text-xs font-mono bg-[#0D1730] border border-[#00E5FF]/20 text-[#00E5FF] hover:border-[#00E5FF] hover:bg-[#00E5FF]/10 transition-all cursor-pointer"
              >
                Python functions & recursion
              </button>
              <button
                onClick={() => handleSend('Explain ModuleNotFoundError and how to resolve it.')}
                className="px-3 py-1.5 rounded-lg text-xs font-mono bg-[#0D1730] border border-[#00E5FF]/20 text-[#00E5FF] hover:border-[#00E5FF] hover:bg-[#00E5FF]/10 transition-all cursor-pointer"
              >
                Explain ModuleNotFoundError
              </button>
              <button
                onClick={() => handleSend('Write a Java binary search implementation with comments.')}
                className="px-3 py-1.5 rounded-lg text-xs font-mono bg-[#0D1730] border border-[#00E5FF]/20 text-[#00E5FF] hover:border-[#00E5FF] hover:bg-[#00E5FF]/10 transition-all cursor-pointer"
              >
                Java binary search code
              </button>
            </div>
          </div>
        )}

        {/* Existing Messages */}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            createdAt={msg.created_at}
          />
        ))}

        {/* Active In-flight Loading Indicator */}
        {isLoading && (
          <div className="my-3">
            <LoadingIndicator />
          </div>
        )}

        {/* Actionable Error State */}
        {error && (
          <div className="my-3">
            <ErrorMessage
              code={error.code}
              message={error.message}
              onRetry={lastFailedMessage ? handleRetry : undefined}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Pinned Bottom Input */}
      <div className="mt-3 shrink-0">
        <ChatInput
          value={inputText}
          onChange={setInputText}
          onSend={() => handleSend()}
          onCancel={handleCancel}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};
