import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { config, isAiConfigured, getApiKey } from './server/config.ts';
import { dbManager } from './server/database.ts';
import { assistantService } from './server/assistant.ts';
import { checkRateLimit } from './server/ratelimit.ts';
import { ErrorCodes, formatError } from './server/errors.ts';
import { getSystemTelemetry } from './server/tools/system_monitor.ts';
import { executeWebSearch } from './server/tools/web_search.ts';
import { TOOL_REGISTRY } from './server/tools/registry.ts';
import { permissionEngine } from './server/permissions/engine.ts';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && config.CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// UUID validator helper
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Initialize Database on startup
dbManager.initialize().catch((err) => {
  console.error('Database initialization failed:', err);
});

/* ========================================================================== */
/*                             API ENDPOINTS                                  */
/* ========================================================================== */

/**
 * GET /api/health
 * Liveness & component health check
 */
app.get('/api/health', async (_req: Request, res: Response) => {
  const isDb = await dbManager.ping();
  return res.json({
    status: isDb ? 'ok' : 'degraded',
    components: {
      stt: 'ready',
      tts: 'ready',
      llm: isAiConfigured() ? 'ready' : 'not_configured',
      search: 'ready',
      database: isDb ? 'connected' : 'error',
    },
  });
});

/**
 * GET /api/status
 * App, database, and AI engine status
 */
app.get('/api/status', async (_req: Request, res: Response) => {
  try {
    const isDbConnected = await dbManager.ping();
    let aiStatus: 'ready' | 'unavailable' | 'not_configured' = 'not_configured';

    if (isAiConfigured()) {
      try {
        const isHealthy = await assistantService.getProvider().checkHealth();
        aiStatus = isHealthy ? 'ready' : 'unavailable';
      } catch {
        aiStatus = 'unavailable';
      }
    }

    const settings = await dbManager.getAllSettings();

    return res.json({
      app: config.APP_NAME,
      version: '1.0.0-upgrade',
      target: 'Kali Linux',
      environment: config.APP_ENV,
      backend: { status: 'connected' },
      database: { status: isDbConnected ? 'connected' : 'error' },
      ai: {
        status: aiStatus,
        provider: config.AI_PROVIDER,
        model: config.AI_MODEL,
      },
      voice: {
        mic_enabled: settings.mic_enabled ?? false,
        wake_word_enabled: settings.wake_word_enabled ?? false,
        tts_enabled: settings.voice_enabled ?? true,
      },
      search: {
        status: 'ready',
      },
    });
  } catch (err) {
    return res.status(500).json(
      formatError(ErrorCodes.DATABASE_ERROR, 'Failed to fetch status')
    );
  }
});

/**
 * GET /api/system/status
 * Real-time CPU, RAM, Disk, Net, Top processes (Figure 5 & Section 4.7)
 */
app.get('/api/system/status', (_req: Request, res: Response) => {
  try {
    const telemetry = getSystemTelemetry();
    return res.json(telemetry);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/voice/transcribe
 * Audio to text transcription
 */
app.post('/api/voice/transcribe', async (req: Request, res: Response) => {
  const { audio_base64, text_transcript } = req.body || {};

  // If text transcript is directly supplied from browser STT
  if (text_transcript && typeof text_transcript === 'string' && text_transcript.trim().length > 0) {
    return res.json({
      transcript: text_transcript.trim(),
      confidence: 0.98,
      source: 'web_speech',
    });
  }

  // Handle uploaded audio blob/base64 via Gemini multimodal audio transcription
  if (audio_base64 && typeof audio_base64 === 'string') {
    const key = getApiKey();
    if (key) {
      try {
        const client = new GoogleGenAI({ apiKey: key });
        const cleanBase64 = audio_base64.replace(/^data:audio\/\w+;base64,/, '');
        const response = await client.models.generateContent({
          model: config.AI_MODEL || 'gemini-3.8-flash',
          contents: [
            {
              inlineData: {
                mimeType: (req.body && req.body.mime_type) || 'audio/webm',
                data: cleanBase64,
              },
            },
            {
              text: 'Transcribe this spoken voice command verbatim. Return ONLY the transcribed text with no extra commentary, no markdown, no quotes. If unintelligible or silence, return an empty string.',
            },
          ],
        });

        const transcript = response.text?.trim() || '';
        return res.json({
          transcript,
          confidence: 0.95,
          source: 'gemini_multimodal_stt',
        });
      } catch (err) {
        console.error('Audio transcription error:', err);
      }
    }
  }

  return res.status(422).json(
    formatError(ErrorCodes.VALIDATION_ERROR, 'Failed to transcribe audio or empty payload.')
  );
});

/**
 * POST /api/voice/speak
 * Text to speech synthesizer configuration
 */
app.post('/api/voice/speak', async (req: Request, res: Response) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(422).json(formatError(ErrorCodes.VALIDATION_ERROR, 'Text is required'));
  }

  const speed = await dbManager.getSetting<number>('voice_speed', 1.0);
  const voice = await dbManager.getSetting<string>('speech_voice', 'en-US');

  return res.json({
    speakable_text: text.slice(0, 400),
    speed,
    voice,
    status: 'ready',
  });
});

/**
 * POST /api/search
 * Web research with source links and citations
 */
app.post('/api/search', async (req: Request, res: Response) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(422).json(formatError(ErrorCodes.VALIDATION_ERROR, 'Query is required'));
  }

  try {
    const searchRes = await executeWebSearch(query);
    return res.json(searchRes);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json(formatError(ErrorCodes.AI_PROVIDER_UNAVAILABLE, msg));
  }
});

/**
 * GET /api/tools
 * List registered tools and risk levels
 */
app.get('/api/tools', (_req: Request, res: Response) => {
  const tools = Object.values(TOOL_REGISTRY).map((t) => ({
    name: t.name,
    description: t.description,
    risk: t.risk,
    parameters: t.parameters,
  }));
  return res.json(tools);
});

/**
 * POST /api/tools/execute
 * Direct execution through Permission Engine
 */
app.post('/api/tools/execute', async (req: Request, res: Response) => {
  const { tool, args } = req.body || {};
  if (!tool || !TOOL_REGISTRY[tool]) {
    return res.status(404).json(formatError(ErrorCodes.VALIDATION_ERROR, `Tool '${tool}' not found`));
  }

  const toolDef = TOOL_REGISTRY[tool];
  try {
    const outcome = await permissionEngine.evaluateAndExecute(toolDef, args || {});
    return res.json(outcome);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json(formatError(ErrorCodes.DATABASE_ERROR, msg));
  }
});

/**
 * GET /api/permissions/pending
 * Pending actions awaiting confirmation
 */
app.get('/api/permissions/pending', async (_req: Request, res: Response) => {
  const pending = await dbManager.getPendingActions();
  return res.json(pending);
});

/**
 * POST /api/permissions/:id/approve
 */
app.post('/api/permissions/:id/approve', async (req: Request, res: Response) => {
  const { id } = req.params;
  const action = await dbManager.getPendingAction(id);
  if (!action || action.status !== 'PENDING') {
    return res.status(404).json(formatError(ErrorCodes.CONVERSATION_NOT_FOUND, 'Action not pending or expired'));
  }

  const toolDef = TOOL_REGISTRY[action.tool];
  if (!toolDef) {
    return res.status(404).json(formatError(ErrorCodes.VALIDATION_ERROR, 'Associated tool not found'));
  }

  try {
    const args = JSON.parse(action.args_json);
    const result = await permissionEngine.evaluateAndExecute(toolDef, args, true);
    await dbManager.updatePendingActionStatus(id, 'APPROVED');
    return res.json({ status: 'APPROVED', result: result.result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json(formatError(ErrorCodes.DATABASE_ERROR, msg));
  }
});

/**
 * POST /api/permissions/:id/reject
 */
app.post('/api/permissions/:id/reject', async (req: Request, res: Response) => {
  const { id } = req.params;
  await dbManager.updatePendingActionStatus(id, 'REJECTED');
  return res.json({ status: 'REJECTED' });
});

/**
 * GET /api/audit
 * Activity feed & audit logs
 */
app.get('/api/audit', async (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit || '25'), 10);
  const logs = await dbManager.getAuditLogs(limit);
  return res.json(logs);
});

/**
 * GET /api/settings
 */
app.get('/api/settings', async (_req: Request, res: Response) => {
  const settings = await dbManager.getAllSettings();
  return res.json(settings);
});

/**
 * PUT /api/settings
 */
app.put('/api/settings', async (req: Request, res: Response) => {
  const updates = req.body;
  if (typeof updates === 'object' && updates !== null) {
    for (const [k, v] of Object.entries(updates)) {
      await dbManager.setSetting(k, v);
    }
  }
  const settings = await dbManager.getAllSettings();
  return res.json(settings);
});

/**
 * POST /api/chat
 * Send a message, trigger tool calls, and get an AI response
 */
app.post('/api/chat', async (req: Request, res: Response) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return res.status(429).json(
      formatError(ErrorCodes.RATE_LIMITED, 'Slow down; try again shortly.')
    );
  }

  const { conversation_id, message, source = 'text' } = req.body || {};

  if (typeof message !== 'string' || message.trim().length === 0) {
    return res.status(422).json(
      formatError(ErrorCodes.VALIDATION_ERROR, 'Message cannot be empty.')
    );
  }

  const trimmedMessage = message.trim();
  if (trimmedMessage.length > config.MAX_MESSAGE_CHARS) {
    return res.status(422).json(
      formatError(
        ErrorCodes.VALIDATION_ERROR,
        `Message exceeds maximum allowed length of ${config.MAX_MESSAGE_CHARS} characters.`
      )
    );
  }

  let convId: string = conversation_id;
  let isNewConversation = false;

  if (convId) {
    if (typeof convId !== 'string' || !UUID_REGEX.test(convId)) {
      return res.status(422).json(
        formatError(ErrorCodes.VALIDATION_ERROR, 'Invalid conversation ID format.')
      );
    }

    try {
      const existingConv = await dbManager.getConversation(convId);
      if (!existingConv) {
        return res.status(404).json(
          formatError(
            ErrorCodes.CONVERSATION_NOT_FOUND,
            'Conversation does not exist or was deleted.'
          )
        );
      }
    } catch {
      return res.status(500).json(
        formatError(ErrorCodes.DATABASE_ERROR, 'Could not read/save conversation. Database: Error.')
      );
    }
  } else {
    isNewConversation = true;
    convId = crypto.randomUUID();
  }

  if (!isAiConfigured()) {
    return res.status(503).json(
      formatError(
        ErrorCodes.AI_NOT_CONFIGURED,
        "EDITH's AI engine is not configured. Set AI_API_KEY and AI_MODEL in .env."
      )
    );
  }

  let historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (!isNewConversation) {
    try {
      const rawMessages = await dbManager.getMessages(convId);
      historyMessages = rawMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
    } catch {
      return res.status(500).json(
        formatError(ErrorCodes.DATABASE_ERROR, 'Could not read/save conversation. Database: Error.')
      );
    }
  }

  // Generate Reply and handle potential tool call
  let assistantResult;
  try {
    assistantResult = await assistantService.generateReply(historyMessages, trimmedMessage);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg === 'AI_NOT_CONFIGURED') {
      return res.status(503).json(
        formatError(ErrorCodes.AI_NOT_CONFIGURED, "EDITH's AI engine is not configured.")
      );
    }
    return res.status(502).json(
      formatError(ErrorCodes.AI_PROVIDER_UNAVAILABLE, 'Could not reach the AI provider; try again.')
    );
  }

  // Persist exchange atomically
  try {
    const title = trimmedMessage.slice(0, 60).trim();
    const msgId = await dbManager.saveExchange(
      convId,
      isNewConversation,
      trimmedMessage,
      assistantResult.reply,
      title,
      source === 'voice' ? 'voice' : 'text'
    );

    // If tool was called, record in tool_calls table
    if (assistantResult.toolCall) {
      await dbManager.recordToolCall(
        msgId,
        assistantResult.toolCall.tool,
        assistantResult.toolCall.args,
        assistantResult.toolCall.risk as any || 'LOW_RISK',
        assistantResult.toolCall.status === 'EXECUTED' ? 'ALLOWED' : 'BLOCKED',
        assistantResult.toolCall.result || {}
      );
    }
  } catch {
    return res.status(500).json(
      formatError(ErrorCodes.DATABASE_ERROR, 'Failed to save conversation exchange.')
    );
  }

  return res.json({
    conversation_id: convId,
    reply: assistantResult.reply,
    toolCall: assistantResult.toolCall,
    pendingAction: assistantResult.pendingAction,
    sources: assistantResult.sources,
    status: 'success',
  });
});

/**
 * GET /api/conversations
 */
app.get('/api/conversations', async (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit || '50'), 10);
  const offset = parseInt(String(req.query.offset || '0'), 10);
  try {
    const list = await dbManager.listConversations(limit, offset);
    return res.json(list);
  } catch {
    return res.status(500).json(
      formatError(ErrorCodes.DATABASE_ERROR, 'Failed to list conversations')
    );
  }
});

/**
 * GET /api/conversations/:id
 */
app.get('/api/conversations/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(422).json(
      formatError(ErrorCodes.VALIDATION_ERROR, 'Malformed conversation ID.')
    );
  }
  try {
    const conversation = await dbManager.getConversation(id);
    if (!conversation) {
      return res.status(404).json(
        formatError(ErrorCodes.CONVERSATION_NOT_FOUND, 'Conversation not found.')
      );
    }
    const messages = await dbManager.getMessages(id);
    return res.json({ conversation, messages });
  } catch {
    return res.status(500).json(
      formatError(ErrorCodes.DATABASE_ERROR, 'Failed to fetch conversation')
    );
  }
});

/**
 * DELETE /api/conversations/:id
 */
app.delete('/api/conversations/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(422).json(
      formatError(ErrorCodes.VALIDATION_ERROR, 'Malformed conversation ID.')
    );
  }
  try {
    const deleted = await dbManager.deleteConversation(id);
    if (!deleted) {
      return res.status(404).json(
        formatError(ErrorCodes.CONVERSATION_NOT_FOUND, 'Conversation not found.')
      );
    }
    return res.json({ status: 'success', deleted_id: id });
  } catch {
    return res.status(500).json(
      formatError(ErrorCodes.DATABASE_ERROR, 'Failed to delete conversation')
    );
  }
});

/* ========================================================================== */
/*                           VITE / FRONTEND SERVING                          */
/* ========================================================================== */

async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        port: config.PORT,
        host: '0.0.0.0',
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`[EDITH] Voice Assistant Upgrade Online on port ${config.PORT}`);
    console.log(`[EDITH] Target: Kali Linux`);
    console.log(`[EDITH] AI Provider: ${config.AI_PROVIDER} (${config.AI_MODEL})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
