# EDITH AI OS (v1.0 Foundation MVP)
### Enhanced Digital Intelligence & Tactical Helper

EDITH is a JARVIS-inspired personal AI assistant and tactical operating environment. Engineered with strict architectural discipline, honest system telemetry, bounded conversation contexts, and persistent SQLite storage.

![EDITH Brand Logo](/edith_logo_lockup.svg)

---

## 1. System Overview & Phases 1-3 Deliverables

The Foundation MVP delivers Phases 1 through 3:
- **Phase 1: Foundation and Architecture**: Connected stack, strict environment configuration, SQLite database with transactional persistence and cascade deletes.
- **Phase 2: Futuristic Dashboard**: Sci-fi tactical HUD interface, animated vector `AIOrb` with real-time state engine (idle, thinking, error, offline), live status diagnostic cards, quick actions, and recent conversation feeds.
- **Phase 3: AI Brain & Chat Intelligence**: Real conversational AI with coding support (Python, Java, algorithms, debugging, explanations), bounded memory context window, auto-titling, and persistent thread management.

### Current Limitations (Strict v1.0 MVP Boundary)
EDITH is operating strictly in Foundation MVP mode:
- ✅ Real text chat, contextual follow-ups, and code generation.
- ✅ Persistent SQLite memory with conversation deletion.
- ❌ **Voice recognition & speech output**: Reserved for Phase 4.
- ❌ **Wake-word detection ("Hey EDITH")**: Reserved for Phase 5.
- ❌ **Desktop automation & tool execution**: Reserved for Phase 6.
- ❌ **Code execution**: Generated code is rendered safely as text with a copy button; code is **never** executed.

---

## 2. Design System Tokens & Brand

- **Void black**: `#05080F` (Page background)
- **Deep navy**: `#0A1128` (Surfaces, sidebar)
- **Panel navy**: `#0D1730` (Cards, panels)
- **EDITH cyan**: `#00E5FF` (Primary highlight, neon glow)
- **Electric blue**: `#2F6BFF` (Accent, buttons, links)
- **Ice text**: `#E6F1FF` (Primary text)
- **Muted text**: `#8FA3BF` (Secondary text)
- **Success**: `#22D3A0` (Connected / Ready)
- **Warning**: `#FFB020` (Not configured)
- **Error**: `#FF4D6A` (Disconnected / Error)

---

## 3. Technology Stack

- **Frontend**: React 19 + TypeScript, Vite, Tailwind CSS, React Router, React-Markdown.
- **Backend**: Express / FastAPI, Pydantic schemas, SQLite persistence with `PRAGMA foreign_keys = ON`.
- **Database**: SQLite `edith.db` (tables `conversations` and `messages` with `ON DELETE CASCADE`).
- **AI Brain**: Configurable provider adapter (`@google/genai` with `gemini-3.8-flash` or custom OpenAI-compatible server).

---

## 4. API Specification & Error Handling

### Endpoints
| Method | Path | Description | Success Response |
|---|---|---|---|
| `GET` | `/api/health` | Liveness health probe | `{"status": "ok"}` |
| `GET` | `/api/status` | Live app, db, and AI telemetry | Status JSON |
| `POST` | `/api/chat` | Send message, get AI reply | `{"conversation_id": "...", "reply": "...", "status": "success"}` |
| `GET` | `/api/conversations` | List saved conversations | `[{"id": "...", "title": "...", "message_count": 2, ...}]` |
| `GET` | `/api/conversations/:id` | Get thread & messages | `{"conversation": {...}, "messages": [...]}` |
| `DELETE` | `/api/conversations/:id` | Purge thread & cascade delete | `{"status": "success", "deleted_id": "..."}` |

### Error Codes Matrix
All errors return a standard JSON structure: `{"status": "error", "error": {"code": "...", "message": "..."}}`:
- `AI_NOT_CONFIGURED` (503): API key or model missing from backend environment.
- `AI_AUTH_FAILED` (502): Provider rejected the API key.
- `AI_PROVIDER_UNAVAILABLE` (502): Could not reach the provider.
- `AI_RATE_LIMITED` (429): Provider or client rate limit exceeded.
- `AI_TIMEOUT` (504): Model took too long to respond.
- `AI_BAD_RESPONSE` (502): Empty or unparseable provider response.
- `DATABASE_ERROR` (500): SQLite query or transaction failure.
- `VALIDATION_ERROR` (422): Empty, oversized (> 4,000 chars), or malformed message.
- `CONVERSATION_NOT_FOUND` (404): Specified session ID does not exist in SQLite.
- `RATE_LIMITED` (429): In-memory client limiter exceeded (> 30 req/min).

---

## 5. Bounded Context Window Architecture

To keep behavior predictable, cost bounded, and latency low:
1. **Load history**: All messages from SQLite in chronological order.
2. **Take newest N**: Bounded to `MAX_CONTEXT_MESSAGES` (default 20).
3. **Trim by size**: Drops oldest messages until total character count is under `MAX_CONTEXT_CHARS` (default 12,000).
4. **Prepend system instruction**: Inserts EDITH system instruction.
5. **Append new message**: Adds validated user input.
6. **1-Transaction commit**: User message and assistant reply are committed atomically only after a successful AI response.

---

## 6. Getting Started & Development

### 1. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure your `GEMINI_API_KEY` (or `AI_API_KEY`) is populated.

### 2. Start Full-Stack Server
```bash
npm run dev
```
The server starts on port `3000` with the live API and Vite frontend bundled seamlessly.

### 3. Build for Production
```bash
npm run build
npm start
```

---

## 7. Roadmap (Phases 4–15)
- **Phase 4**: Voice recognition and text-to-speech audio synthesis.
- **Phase 5**: Hands-free wake-word detection engine.
- **Phase 6**: Desktop control and sandbox automation with granular permission prompts.
- **Phase 7**: Long-term personal memory graph.
- **Phase 8-10**: File intelligence, grounded search, and isolated code sandbox.
- **Phase 11-15**: Native packaging, multi-device sync, and hardened security.
