export interface HealthResponse {
  status: 'ok' | 'degraded';
  components?: {
    stt: string;
    tts: string;
    llm: string;
    search: string;
    database: string;
  };
}

export interface StatusResponse {
  app: string;
  version: string;
  target?: string;
  environment: string;
  backend: {
    status: 'connected' | 'disconnected';
  };
  database: {
    status: 'connected' | 'error';
  };
  ai: {
    status: 'ready' | 'unavailable' | 'not_configured';
    provider: string;
    model: string;
  };
  voice?: {
    mic_enabled: boolean;
    wake_word_enabled: boolean;
    tts_enabled: boolean;
  };
  search?: {
    status: string;
  };
}

export interface SystemStats {
  cpu_percent: number;
  ram_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  network_status: string;
  uptime_hours: number;
  platform: string;
  top_processes: Array<{
    pid: number;
    name: string;
    cpu_percent: number;
    mem_percent: number;
  }>;
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface PendingAction {
  id: string;
  tool: string;
  args_json: string;
  impact_text: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  expires_at: string;
}

export interface AuditLogItem {
  id: string;
  ts: string;
  actor: string;
  event: string;
  details_json: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface MessageItem {
  id: number;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  source?: 'voice' | 'text';
  created_at: string;
}

export interface ConversationDetail {
  conversation: {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
  };
  messages: MessageItem[];
}

export interface ChatResponse {
  conversation_id: string;
  reply: string;
  toolCall?: {
    tool: string;
    args: Record<string, unknown>;
    result?: Record<string, unknown>;
    status: 'EXECUTED' | 'REQUIRES_CONFIRMATION' | 'BLOCKED';
  };
  pendingAction?: PendingAction;
  sources?: SearchResultItem[];
  status: 'success';
}

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiErrorPayload {
  status: 'error';
  error: ApiError;
}
