import React, { useState, useCallback } from 'react';
import {
  Mic,
  VolumeX,
  Send,
  Radio,
  Sparkles,
  ExternalLink,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { AIOrb, OrbState } from '../components/AIOrb.tsx';
import { SystemMonitor } from '../components/SystemMonitor.tsx';
import { ActivityFeed } from '../components/ActivityFeed.tsx';
import { PermissionDialog } from '../components/PermissionDialog.tsx';
import { VoiceConsole } from '../components/VoiceConsole.tsx';
import { MessageBubble } from '../components/MessageBubble.tsx';
import { LoadingIndicator } from '../components/LoadingIndicator.tsx';
import { ErrorMessage } from '../components/ErrorMessage.tsx';
import { useStatus } from '../hooks/useStatus.ts';
import { useVoice } from '../hooks/useVoice.ts';
import { api, ApiClientError } from '../services/api.ts';
import { MessageItem, SearchResultItem } from '../types/api.ts';

export const Dashboard: React.FC = () => {
  const { isBackendConnected } = useStatus();
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [activeSources, setActiveSources] = useState<SearchResultItem[]>([]);
  const [commandInput, setCommandInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Send command to backend
  const handleSendCommand = useCallback(
    async (textToSend: string, source: 'voice' | 'text' = 'text') => {
      const cleanText = textToSend.trim();
      if (!cleanText || isLoading) return;

      setError(null);

      // Optimistic user message
      const tempUserMsg: MessageItem = {
        id: Date.now(),
        conversation_id: conversationId || 'active',
        role: 'user',
        content: cleanText,
        source,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, tempUserMsg]);
      setCommandInput('');
      setIsLoading(true);

      try {
        const response = await api.sendMessage(cleanText, conversationId, source);

        if (!conversationId && response.conversation_id) {
          setConversationId(response.conversation_id);
        }

        const assistantMsg: MessageItem = {
          id: Date.now() + 1,
          conversation_id: response.conversation_id,
          role: 'assistant',
          content: response.reply,
          source: 'text',
          created_at: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        if (response.sources && response.sources.length > 0) {
          setActiveSources(response.sources);
        }

        // Voice output: vocalize answer aloud via SpeechSynthesis
        speak(response.reply);
      } catch (err: unknown) {
        if (err instanceof ApiClientError) {
          setError({ code: err.code, message: err.message });
        } else {
          setError({ code: 'COMMAND_FAILED', message: 'Failed to process command.' });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, isLoading]
  );

  // Initialize Voice Engine Hook
  const {
    isListening,
    isSpeaking,
    isTranscribing,
    transcript,
    audioLevel,
    micError,
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
    setTranscript,
  } = useVoice({
    onTranscriptReady: (spokenText) => {
      handleSendCommand(spokenText, 'voice');
    },
    wakeWordEnabled: false,
    wakePhrase: 'hey edith',
  });

  // Calculate dynamic 5-state AIOrb
  let orbState: OrbState = 'idle';
  if (!isBackendConnected) {
    orbState = 'offline';
  } else if (error) {
    orbState = 'error';
  } else if (isListening) {
    orbState = 'listening';
  } else if (isLoading || isTranscribing) {
    orbState = 'thinking';
  } else if (isSpeaking) {
    orbState = 'speaking';
  } else {
    orbState = 'idle';
  }

  return (
    <div className="max-w-[1600px] mx-auto px-3 md:px-6 py-4 flex flex-col h-[calc(100vh-4rem)] space-y-4">
      {/* 3-Column Tactical HUD Layout matching Figure 5 */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0 overflow-hidden">
        {/* Left Column: System Monitor (3 cols) */}
        <div className="lg:col-span-3 flex flex-col space-y-3 overflow-y-auto">
          <SystemMonitor />

          {/* Quick Voice Hints */}
          <div className="p-3.5 rounded-2xl bg-[#0D1730]/70 border border-[#00E5FF]/15 text-xs font-mono space-y-2">
            <span className="text-[10px] text-[#00E5FF] uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5" /> VOICE SHORTCUTS
            </span>
            <div className="space-y-1.5 text-[#8FA3BF]">
              <p
                onClick={() => handleSendCommand('Open VS Code', 'voice')}
                className="hover:text-[#00E5FF] cursor-pointer truncate"
              >
                &bull; &ldquo;Open VS Code&rdquo;
              </p>
              <p
                onClick={() => handleSendCommand('Check my CPU and RAM', 'voice')}
                className="hover:text-[#00E5FF] cursor-pointer truncate"
              >
                &bull; &ldquo;Check my CPU and RAM&rdquo;
              </p>
              <p
                onClick={() => handleSendCommand('Search for latest AI cybersecurity news', 'voice')}
                className="hover:text-[#00E5FF] cursor-pointer truncate"
              >
                &bull; &ldquo;Search AI cybersecurity news&rdquo;
              </p>
              <p
                onClick={() => handleSendCommand('Create a note called ideas.md with tactical tips', 'voice')}
                className="hover:text-[#00E5FF] cursor-pointer truncate"
              >
                &bull; &ldquo;Create a note called ideas.md&rdquo;
              </p>
              <p
                onClick={() => handleSendCommand('Delete test.txt from workspace', 'voice')}
                className="hover:text-[#FF4D6A] cursor-pointer truncate"
              >
                &bull; &ldquo;Delete test.txt from workspace&rdquo;
              </p>
            </div>
          </div>
        </div>

        {/* Center Column: Animated Orb, Voice Console & Chat Panel (6 cols) */}
        <div className="lg:col-span-6 flex flex-col h-full space-y-3 min-h-0">
          {/* Central AIOrb & Voice Console */}
          <div className="shrink-0 flex flex-col items-center justify-center p-3 rounded-2xl bg-[#0A1128]/60 border border-[#00E5FF]/15 space-y-2">
            <AIOrb size="md" state={orbState} showStatusLabel />

            {/* Voice Console with live audio visualizer */}
            <VoiceConsole
              transcript={transcript}
              isListening={isListening}
              isSpeaking={isSpeaking}
              isTranscribing={isTranscribing}
              audioLevel={audioLevel}
              micError={micError}
              onSendTranscript={(text) => handleSendCommand(text, 'voice')}
              onClear={() => setTranscript('')}
              onSimulateVoice={(preset) => handleSendCommand(preset, 'voice')}
            />
          </div>

          {/* Chat Panel / Message Exchange */}
          <div className="flex-1 rounded-2xl bg-[#0D1730]/60 border border-[#00E5FF]/15 p-4 overflow-y-auto space-y-3 min-h-0">
            {messages.length === 0 && !isLoading && (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-xs font-mono text-[#8FA3BF] space-y-2">
                <Sparkles className="w-6 h-6 text-[#00E5FF] mx-auto animate-pulse" />
                <p className="text-sm font-semibold text-white font-['Orbitron',sans-serif]">
                  EDITH TACTICAL COCKPIT READY
                </p>
                <p className="max-w-md">
                  Click the pulsing <span className="text-[#00E5FF] font-bold">[MIC]</span> button below to talk to EDITH.
                  Allow browser microphone access when prompted.
                </p>
              </div>
            )}

            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                role={m.role}
                content={m.content}
                createdAt={m.created_at}
              />
            ))}

            {isLoading && <LoadingIndicator message="EDITH is evaluating intent and tools..." />}

            {error && <ErrorMessage code={error.code} message={error.message} />}

            {/* Active Web Search Sources Panel */}
            {activeSources.length > 0 && (
              <div className="p-3 rounded-xl bg-[#0A1128] border border-[#00E5FF]/30 space-y-1.5 mt-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#00E5FF] font-bold">
                  Verified Research Citations
                </span>
                <div className="space-y-1">
                  {activeSources.map((s, idx) => (
                    <a
                      key={idx}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between text-xs font-mono text-[#8FA3BF] hover:text-[#00E5FF] p-1.5 rounded bg-[#0D1730] border border-[#00E5FF]/10 transition-colors"
                    >
                      <span className="truncate max-w-[85%]">{s.title}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Activity Feed & Permission Dialog (3 cols) */}
        <div className="lg:col-span-3 flex flex-col space-y-3 overflow-y-auto">
          {/* Permission Card / Dialog (Figure 5: Permission Delete 3 files?) */}
          <PermissionDialog
            onActionDecided={() => {
              // Action handled
            }}
          />

          {/* Activity Feed (Figure 5: 12:01 search ok ...) */}
          <ActivityFeed />

          {/* Kali Linux Authorized Target Scope Card */}
          <div className="p-3.5 rounded-2xl bg-[#0D1730]/70 border border-[#00E5FF]/15 text-xs font-mono space-y-2">
            <div className="flex items-center gap-1.5 text-[#22D3A0] font-bold">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>DEFENSE SCOPE</span>
            </div>
            <p className="text-[11px] text-[#8FA3BF] leading-relaxed">
              Assessment tools restricted to authorized targets:
            </p>
            <div className="p-2 rounded bg-[#060C1B] border border-[#00E5FF]/10 text-[10px] text-[#00E5FF]">
              127.0.0.1, localhost, 192.168.1.0/24
            </div>
          </div>
        </div>
      </div>

      {/* Pinned Bottom Command Bar matching Figure 5 */}
      {/* [ MIC ] Type or speak a command ... [ SEND ] [ STOP SPEAKING ] */}
      <div className="shrink-0 p-2.5 rounded-2xl bg-[#0D1730]/95 border border-[#00E5FF]/30 shadow-[0_4px_25px_rgba(0,0,0,0.6)] flex items-center gap-2">
        {/* [ MIC ] Button */}
        <button
          onClick={toggleListening}
          title={isListening ? 'Click to stop recording and send' : 'Click to start speaking'}
          className={`px-4 py-2.5 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            isTranscribing
              ? 'bg-[#2F6BFF] text-white animate-pulse'
              : isListening
              ? 'bg-[#FF4D6A] text-white shadow-[0_0_20px_rgba(255,77,106,0.8)] animate-pulse'
              : 'bg-[#0A1128] text-[#00E5FF] border border-[#00E5FF]/40 hover:bg-[#00E5FF]/20 hover:border-[#00E5FF]'
          }`}
        >
          {isTranscribing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="hidden sm:inline">TRANSCRIBING...</span>
            </>
          ) : isListening ? (
            <>
              <Mic className="w-4 h-4 animate-ping" />
              <span className="hidden sm:inline">STOP MIC</span>
              {audioLevel > 15 && (
                <span className="w-2 h-2 rounded-full bg-[#22D3A0] animate-ping" />
              )}
            </>
          ) : (
            <>
              <Mic className="w-4 h-4" />
              <span className="hidden sm:inline">MIC</span>
            </>
          )}
        </button>

        {/* Input Text Box */}
        <input
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSendCommand(commandInput, 'text');
            }
          }}
          placeholder="Speak by clicking [MIC] or type command (e.g. 'check my CPU', 'open VS Code')..."
          className="flex-1 bg-transparent px-3 py-2 text-sm text-[#E6F1FF] placeholder-[#8FA3BF]/60 focus:outline-none font-sans"
        />

        {/* [ SEND / TRANSMIT ] Button */}
        <button
          onClick={() => handleSendCommand(commandInput, 'text')}
          disabled={!commandInput.trim() || isLoading}
          className="px-4 py-2.5 rounded-xl font-mono text-xs font-bold bg-gradient-to-r from-[#00E5FF] to-[#2F6BFF] text-[#05080F] hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 cursor-pointer"
        >
          <span>SEND</span>
          <Send className="w-3.5 h-3.5" />
        </button>

        {/* [ STOP SPEAKING ] Button */}
        {isSpeaking && (
          <button
            onClick={stopSpeaking}
            className="px-3 py-2.5 rounded-xl font-mono text-xs font-bold bg-[#FF4D6A]/20 text-[#FF4D6A] border border-[#FF4D6A]/40 hover:bg-[#FF4D6A] hover:text-white transition-all flex items-center gap-1.5 cursor-pointer"
            title="Interrupt speech output"
          >
            <VolumeX className="w-3.5 h-3.5" />
            <span className="hidden md:inline">STOP SPEAKING</span>
          </button>
        )}
      </div>
    </div>
  );
};
