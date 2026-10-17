import {
  HealthResponse,
  StatusResponse,
  SystemStats,
  SearchResultItem,
  PendingAction,
  AuditLogItem,
  ConversationSummary,
  ConversationDetail,
  ChatResponse,
  ApiErrorPayload,
} from '../types/api.ts';

export class ApiClientError extends Error {
  public code: string;
  public status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = 35000
): Promise<T> {
  const controller = new AbortController();
  const signal = options.signal || controller.signal;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      ...options,
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    clearTimeout(timeoutId);

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json() : null;

    if (!response.ok) {
      if (data && data.status === 'error' && data.error) {
        const errPayload = data as ApiErrorPayload;
        throw new ApiClientError(
          errPayload.error.code,
          errPayload.error.message,
          response.status
        );
      }
      throw new ApiClientError(
        'HTTP_ERROR',
        `Request failed with status ${response.status}`,
        response.status
      );
    }

    return data as T;
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof ApiClientError) {
      throw err;
    }

    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        throw new ApiClientError(
          'REQUEST_ABORTED',
          'The request was cancelled or timed out.',
          408
        );
      }
      throw new ApiClientError('NETWORK_ERROR', err.message, 0);
    }

    throw new ApiClientError('UNKNOWN_ERROR', 'An unexpected error occurred.', 500);
  }
}

export const api = {
  getHealth: (signal?: AbortSignal) =>
    request<HealthResponse>('/api/health', { method: 'GET', signal }, 5000),

  getStatus: (signal?: AbortSignal) =>
    request<StatusResponse>('/api/status', { method: 'GET', signal }, 10000),

  transcribeAudio: (
    audioBase64?: string,
    mimeType = 'audio/webm',
    textTranscript?: string,
    signal?: AbortSignal
  ) =>
    request<{ transcript: string; confidence: number; source: string }>(
      '/api/voice/transcribe',
      {
        method: 'POST',
        signal,
        body: JSON.stringify({
          audio_base64: audioBase64,
          mime_type: mimeType,
          text_transcript: textTranscript,
        }),
      },
      25000
    ),

  getSystemStatus: (signal?: AbortSignal) =>
    request<SystemStats>('/api/system/status', { method: 'GET', signal }, 5000),

  searchWeb: (query: string, signal?: AbortSignal) =>
    request<{ query: string; results: SearchResultItem[]; summary: string }>(
      '/api/search',
      {
        method: 'POST',
        signal,
        body: JSON.stringify({ query }),
      },
      15000
    ),

  getTools: (signal?: AbortSignal) =>
    request<Array<{ name: string; description: string; risk: string }>>(
      '/api/tools',
      { method: 'GET', signal },
      5000
    ),

  getPendingActions: (signal?: AbortSignal) =>
    request<PendingAction[]>('/api/permissions/pending', { method: 'GET', signal }, 5000),

  approveAction: (id: string, signal?: AbortSignal) =>
    request<{ status: string; result?: Record<string, unknown> }>(
      `/api/permissions/${encodeURIComponent(id)}/approve`,
      { method: 'POST', signal },
      10000
    ),

  rejectAction: (id: string, signal?: AbortSignal) =>
    request<{ status: string }>(
      `/api/permissions/${encodeURIComponent(id)}/reject`,
      { method: 'POST', signal },
      10000
    ),

  getAuditLogs: (limit = 25, signal?: AbortSignal) =>
    request<AuditLogItem[]>(`/api/audit?limit=${limit}`, { method: 'GET', signal }, 5000),

  getSettings: (signal?: AbortSignal) =>
    request<Record<string, unknown>>('/api/settings', { method: 'GET', signal }, 5000),

  updateSettings: (updates: Record<string, unknown>, signal?: AbortSignal) =>
    request<Record<string, unknown>>(
      '/api/settings',
      {
        method: 'PUT',
        signal,
        body: JSON.stringify(updates),
      },
      5000
    ),

  sendMessage: (
    message: string,
    conversationId: string | null = null,
    source: 'voice' | 'text' = 'text',
    signal?: AbortSignal
  ) =>
    request<ChatResponse>(
      '/api/chat',
      {
        method: 'POST',
        signal,
        body: JSON.stringify({
          conversation_id: conversationId,
          message,
          source,
        }),
      },
      35000
    ),

  getConversations: (limit = 50, offset = 0, signal?: AbortSignal) =>
    request<ConversationSummary[]>(
      `/api/conversations?limit=${limit}&offset=${offset}`,
      { method: 'GET', signal },
      10000
    ),

  getConversation: (id: string, signal?: AbortSignal) =>
    request<ConversationDetail>(
      `/api/conversations/${encodeURIComponent(id)}`,
      { method: 'GET', signal },
      10000
    ),

  deleteConversation: (id: string, signal?: AbortSignal) =>
    request<{ status: 'success'; deleted_id: string }>(
      `/api/conversations/${encodeURIComponent(id)}`,
      { method: 'DELETE', signal },
      10000
    ),
};
