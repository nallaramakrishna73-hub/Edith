import dotenv from 'dotenv';
dotenv.config();

export const config = {
  APP_NAME: process.env.APP_NAME || 'EDITH',
  APP_ENV: process.env.APP_ENV || process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || 'sqlite:///./edith.db',
  AI_PROVIDER: process.env.AI_PROVIDER || 'google-gemini',
  AI_MODEL: process.env.AI_MODEL || 'gemini-3.1-flash-lite',
  FALLBACK_MODELS: ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-4-argon'],
  AI_BASE_URL: process.env.AI_BASE_URL || '',
  AI_TIMEOUT_SECONDS: parseInt(process.env.AI_TIMEOUT_SECONDS || '30', 10),
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000').split(','),
  MAX_MESSAGE_CHARS: parseInt(process.env.MAX_MESSAGE_CHARS || '4000', 10),
  MAX_CONTEXT_MESSAGES: parseInt(process.env.MAX_CONTEXT_MESSAGES || '20', 10),
  MAX_CONTEXT_CHARS: parseInt(process.env.MAX_CONTEXT_CHARS || '12000', 10),
  RATE_LIMIT_PER_MINUTE: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '30', 10),
  PORT: parseInt(process.env.PORT || '3000', 10),
};

export function getApiKey(): string | undefined {
  return process.env.AI_API_KEY || process.env.GEMINI_API_KEY;
}

export function isAiConfigured(): boolean {
  const key = getApiKey();
  return Boolean(key && key.trim().length > 0 && config.AI_MODEL);
}
