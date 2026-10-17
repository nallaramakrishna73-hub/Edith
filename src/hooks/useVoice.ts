import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api.ts';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: Event) => void;
  onend: () => void;
}

export function useVoice({
  onTranscriptReady,
  wakeWordEnabled = false,
  wakePhrase = 'hey edith',
}: {
  onTranscriptReady: (transcript: string) => void;
  wakeWordEnabled?: boolean;
  wakePhrase?: string;
}) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [detectedIntent, setDetectedIntent] = useState('');
  const [audioLevel, setAudioLevel] = useState(0); // 0 to 100 volume meter
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [micError, setMicError] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const liveInterimTranscriptRef = useRef('');
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Check microphone permissions on mount
  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((permissionStatus) => {
          setMicPermission(permissionStatus.state as 'prompt' | 'granted' | 'denied');
          permissionStatus.onchange = () => {
            setMicPermission(permissionStatus.state as 'prompt' | 'granted' | 'denied');
          };
        })
        .catch(() => {
          // fallback
        });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      recognitionRef.current?.abort();
    };
  }, []);

  // Stop recording and process audio
  const stopListening = useCallback(async () => {
    if (!isListening) return;

    setIsListening(false);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    // Stop speech recognition if running
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }

    // Stop audio meter animation
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setAudioLevel(0);

    // Stop MediaRecorder and finalize transcription
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      setIsTranscribing(true);

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        audioChunksRef.current = [];

        // Check if browser SpeechRecognition already provided a transcript
        const browserText = liveInterimTranscriptRef.current.trim();
        if (browserText.length > 0) {
          setTranscript(browserText);
          setIsTranscribing(false);
          onTranscriptReady(browserText);
          liveInterimTranscriptRef.current = '';
          return;
        }

        // If no browser text, send recorded audio blob to backend Gemini STT
        if (audioBlob.size > 1000) {
          try {
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = async () => {
              const base64Audio = reader.result as string;
              try {
                const res = await api.transcribeAudio(
                  base64Audio,
                  audioBlob.type || 'audio/webm'
                );
                const finalTranscript = res.transcript?.trim() || '';
                if (finalTranscript) {
                  setTranscript(finalTranscript);
                  onTranscriptReady(finalTranscript);
                } else {
                  setMicError('No clear speech was detected. Please speak closer to your microphone.');
                }
              } catch (err) {
                console.warn('Backend STT failed:', err);
                setMicError('Audio transcription failed. You can also type commands directly.');
              } finally {
                setIsTranscribing(false);
              }
            };
          } catch {
            setIsTranscribing(false);
          }
        } else {
          setIsTranscribing(false);
        }
      };

      try {
        recorder.stop();
      } catch {
        setIsTranscribing(false);
      }
    } else {
      const browserText = liveInterimTranscriptRef.current.trim();
      if (browserText) {
        setTranscript(browserText);
        onTranscriptReady(browserText);
      }
      liveInterimTranscriptRef.current = '';
    }

    // Release microphone track
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }, [isListening, onTranscriptReady]);

  // Start listening: request getUserMedia + start MediaRecorder + Web Speech fallback
  const startListening = useCallback(async () => {
    setMicError(null);
    setTranscript('');
    setDetectedIntent('');
    liveInterimTranscriptRef.current = '';
    audioChunksRef.current = [];

    // Stop speaking if EDITH is talking (barge-in)
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);

    try {
      // 1. Request real microphone access via getUserMedia
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;
      setMicPermission('granted');

      // 2. Set up Web Audio Analyser for live visualizer feedback
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        const sourceNode = audioCtx.createMediaStreamSource(stream);
        sourceNode.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (!mediaStreamRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          // Scale to 0-100
          const level = Math.min(100, Math.round((avg / 128) * 100));
          setAudioLevel(level);

          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        updateLevel();
      } catch (err) {
        console.warn('AudioContext meter unavailable:', err);
      }

      // 3. Set up MediaRecorder
      let mimeType = 'audio/webm';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          mimeType = 'audio/ogg';
        }

        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        recorder.start(250); // Slice every 250ms
      }

      // 4. Also start Web Speech API if supported for live interim preview
      const win = window as unknown as Record<string, new () => SpeechRecognitionInstance>;
      const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

      if (SpeechRecognitionClass) {
        try {
          const recognition = new SpeechRecognitionClass();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';

          recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interim = '';
            for (let i = 0; i < event.results.length; i++) {
              interim += event.results[i][0].transcript;
            }
            if (interim.trim()) {
              liveInterimTranscriptRef.current = interim.trim();
              setTranscript(interim.trim());

              // Check for wake phrase if armed
              if (wakeWordEnabled && interim.toLowerCase().includes(wakePhrase.toLowerCase())) {
                setDetectedIntent('WAKE_WORD_ACTIVATED');
              }
            }
          };

          recognition.onerror = (_e: Event) => {
            // SpeechRecognition interim event
          };

          recognition.onend = () => {
            // keep alive until user stops
          };

          recognitionRef.current = recognition;
          recognition.start();
        } catch (e) {
          console.warn('SpeechRecognition start failed (MediaRecorder will handle it):', e);
        }
      }

      setIsListening(true);
    } catch (err: unknown) {
      console.error('Microphone access failed:', err);
      const e = err as { name?: string; message?: string };
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setMicPermission('denied');
        setMicError('Microphone permission denied. Click the lock/camera icon in your address bar to allow microphone.');
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        setMicError('No microphone found on this device.');
      } else {
        setMicError(`Microphone error: ${e.message || 'Unable to access microphone'}.`);
      }
      setIsListening(false);
    }
  }, [wakeWordEnabled, wakePhrase]);

  // Toggle listening
  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Text-to-Speech synthesis with barge-in support
  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    // Strip markdown formatting for voice
    const cleanSpeech = text
      .replace(/[*_#`[\]()]/g, '')
      .replace(/https?:\/\/\S+/g, 'link')
      .replace(/\{[\s\S]*?\}/g, '')
      .slice(0, 350);

    const utterance = new SpeechSynthesisUtterance(cleanSpeech);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, []);

  // Stop speaking
  const stopSpeaking = useCallback(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  return {
    isListening,
    isSpeaking,
    isTranscribing,
    transcript,
    detectedIntent,
    audioLevel,
    micPermission,
    micError,
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
    setTranscript,
  };
}
