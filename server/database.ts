import fs from 'fs';
import path from 'path';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';

export interface DbConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface DbMessage {
  id: number;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  source?: 'voice' | 'text';
  created_at: string;
}

export interface DbToolCall {
  id: string;
  message_id?: number | null;
  tool: string;
  args_json: string;
  risk: 'READ_ONLY' | 'LOW_RISK' | 'REQUIRES_CONFIRMATION' | 'BLOCKED_BY_DEFAULT';
  decision: 'ALLOWED' | 'CONFIRMED' | 'REJECTED' | 'BLOCKED';
  result_json: string;
  created_at: string;
}

export interface DbPendingAction {
  id: string;
  tool: string;
  args_json: string;
  impact_text: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  expires_at: string;
}

export interface DbAuditLog {
  id: string;
  ts: string;
  actor: string;
  event: string;
  details_json: string;
}

class DatabaseManager {
  private db: SqlJsDatabase | null = null;
  private dbPath: string = path.resolve(process.cwd(), 'edith.db');
  private initPromise: Promise<void> | null = null;

  public async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const SQL = await initSqlJs();
      if (fs.existsSync(this.dbPath)) {
        try {
          const fileBuffer = fs.readFileSync(this.dbPath);
          this.db = new SQL.Database(fileBuffer);
        } catch {
          this.db = new SQL.Database();
        }
      } else {
        this.db = new SQL.Database();
      }

      this.db.run('PRAGMA foreign_keys = ON;');

      // 1. Conversations
      this.db.run(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 2. Messages
      this.db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          source TEXT DEFAULT 'text',
          created_at TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
      `);

      try {
        this.db.run('ALTER TABLE messages ADD COLUMN source TEXT DEFAULT "text";');
      } catch {
        // column already exists
      }

      // 3. Tool Calls
      this.db.run(`
        CREATE TABLE IF NOT EXISTS tool_calls (
          id TEXT PRIMARY KEY,
          message_id INTEGER,
          tool TEXT NOT NULL,
          args_json TEXT NOT NULL,
          risk TEXT NOT NULL,
          decision TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
        );
      `);

      // 4. Pending Actions (for approval dialog)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS pending_actions (
          id TEXT PRIMARY KEY,
          tool TEXT NOT NULL,
          args_json TEXT NOT NULL,
          impact_text TEXT NOT NULL,
          status TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
      `);

      // 5. System Settings
      this.db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        );
      `);

      // 6. Audit Log
      this.db.run(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          ts TEXT NOT NULL,
          actor TEXT NOT NULL,
          event TEXT NOT NULL,
          details_json TEXT NOT NULL
        );
      `);

      // 7. Search Cache
      this.db.run(`
        CREATE TABLE IF NOT EXISTS search_cache (
          query TEXT PRIMARY KEY,
          results_json TEXT NOT NULL,
          fetched_at TEXT NOT NULL
        );
      `);

      // Seed default settings if empty
      this.seedDefaultSettings();

      this.saveToDisk();
    })();

    return this.initPromise;
  }

  private seedDefaultSettings(): void {
    if (!this.db) return;
    const defaults: Record<string, unknown> = {
      mic_enabled: false,
      voice_enabled: true,
      wake_word_enabled: false,
      wake_phrase: 'Hey EDITH',
      voice_speed: 1.0,
      speech_voice: 'en-US',
      workspace_dir: '~/workspace',
      allowed_scan_targets: ['127.0.0.1', 'localhost', '192.168.1.0/24'],
      allowed_applications: ['firefox', 'code', 'terminal', 'thunar', 'burpsuite', 'wireshark'],
      privacy_retention_days: 30,
    };

    for (const [key, val] of Object.entries(defaults)) {
      try {
        const stmt = this.db.prepare('SELECT key FROM settings WHERE key = :k');
        stmt.bind({ ':k': key });
        if (!stmt.step()) {
          this.db.run('INSERT INTO settings (key, value_json) VALUES (?, ?)', [
            key,
            JSON.stringify(val),
          ]);
        }
        stmt.free();
      } catch {
        // ignore
      }
    }
  }

  private saveToDisk(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (err) {
      console.error('Failed to persist SQLite database to disk:', err);
    }
  }

  public async ping(): Promise<boolean> {
    await this.initialize();
    if (!this.db) return false;
    try {
      const result = this.db.exec('SELECT 1 as alive;');
      return Boolean(result.length > 0 && result[0].values.length > 0);
    } catch {
      return false;
    }
  }

  public async getConversation(id: string): Promise<DbConversation | null> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(
      'SELECT id, title, created_at, updated_at FROM conversations WHERE id = :id'
    );
    stmt.bind({ ':id': id });

    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as DbConversation;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  public async listConversations(limit = 50, offset = 0): Promise<DbConversation[]> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT 
        c.id, 
        c.title, 
        c.created_at, 
        c.updated_at,
        COUNT(m.id) as message_count
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT :limit OFFSET :offset
    `);

    stmt.bind({ ':limit': limit, ':offset': offset });

    const results: DbConversation[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: String(row.id),
        title: String(row.title),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        message_count: Number(row.message_count || 0),
      });
    }
    stmt.free();
    return results;
  }

  public async getMessages(conversationId: string): Promise<DbMessage[]> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT id, conversation_id, role, content, source, created_at
      FROM messages
      WHERE conversation_id = :cid
      ORDER BY id ASC
    `);

    stmt.bind({ ':cid': conversationId });

    const messages: DbMessage[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      messages.push({
        id: Number(row.id),
        conversation_id: String(row.conversation_id),
        role: row.role as 'user' | 'assistant',
        content: String(row.content),
        source: (row.source as 'voice' | 'text') || 'text',
        created_at: String(row.created_at),
      });
    }
    stmt.free();
    return messages;
  }

  public async saveExchange(
    conversationId: string,
    isNew: boolean,
    userMessage: string,
    assistantReply: string,
    title?: string,
    source: 'voice' | 'text' = 'text'
  ): Promise<number> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();

    try {
      this.db.run('BEGIN TRANSACTION;');

      if (isNew) {
        const convTitle = title || userMessage.slice(0, 60).trim();
        this.db.run(
          'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?);',
          [conversationId, convTitle, now, now]
        );
      } else {
        this.db.run('UPDATE conversations SET updated_at = ? WHERE id = ?;', [
          now,
          conversationId,
        ]);
      }

      this.db.run(
        'INSERT INTO messages (conversation_id, role, content, source, created_at) VALUES (?, ?, ?, ?, ?);',
        [conversationId, 'user', userMessage, source, now]
      );

      this.db.run(
        'INSERT INTO messages (conversation_id, role, content, source, created_at) VALUES (?, ?, ?, ?, ?);',
        [conversationId, 'assistant', assistantReply, source, now]
      );

      // Fetch last insert id
      const res = this.db.exec('SELECT last_insert_rowid() as id;');
      const lastId = res[0]?.values[0]?.[0] ? Number(res[0].values[0][0]) : 0;

      this.db.run('COMMIT;');
      this.saveToDisk();
      return lastId;
    } catch (error) {
      try {
        this.db.run('ROLLBACK;');
      } catch {
        // ignore
      }
      throw error;
    }
  }

  public async deleteConversation(id: string): Promise<boolean> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    const conv = await this.getConversation(id);
    if (!conv) return false;

    try {
      this.db.run('BEGIN TRANSACTION;');
      this.db.run('DELETE FROM messages WHERE conversation_id = ?;', [id]);
      this.db.run('DELETE FROM conversations WHERE id = ?;', [id]);
      this.db.run('COMMIT;');
      this.saveToDisk();
      return true;
    } catch (err) {
      try {
        this.db.run('ROLLBACK;');
      } catch {
        // ignore
      }
      throw err;
    }
  }

  /* ---------------------- AUDIT LOGGING & ACTIVITY ------------------------ */

  public async addAuditLog(
    actor: string,
    event: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await this.initialize();
    if (!this.db) return;
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();
    try {
      this.db.run(
        'INSERT INTO audit_log (id, ts, actor, event, details_json) VALUES (?, ?, ?, ?, ?)',
        [id, ts, actor, event, JSON.stringify(details)]
      );
      this.saveToDisk();
    } catch (e) {
      console.error('Failed to log audit event:', e);
    }
  }

  public async getAuditLogs(limit = 20): Promise<DbAuditLog[]> {
    await this.initialize();
    if (!this.db) return [];
    try {
      const stmt = this.db.prepare(
        'SELECT id, ts, actor, event, details_json FROM audit_log ORDER BY ts DESC LIMIT :limit'
      );
      stmt.bind({ ':limit': limit });
      const logs: DbAuditLog[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        logs.push({
          id: String(row.id),
          ts: String(row.ts),
          actor: String(row.actor),
          event: String(row.event),
          details_json: String(row.details_json),
        });
      }
      stmt.free();
      return logs;
    } catch {
      return [];
    }
  }

  /* ------------------- PENDING ACTIONS & PERMISSIONS --------------------- */

  public async createPendingAction(
    tool: string,
    args: Record<string, unknown>,
    impactText: string,
    expiresInSeconds = 60
  ): Promise<DbPendingAction> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const action: DbPendingAction = {
      id,
      tool,
      args_json: JSON.stringify(args),
      impact_text: impactText,
      status: 'PENDING',
      expires_at: expiresAt,
    };

    this.db.run(
      'INSERT INTO pending_actions (id, tool, args_json, impact_text, status, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [action.id, action.tool, action.args_json, action.impact_text, action.status, action.expires_at]
    );
    this.saveToDisk();

    await this.addAuditLog('system', 'PENDING_ACTION_CREATED', {
      action_id: id,
      tool,
      impact: impactText,
    });

    return action;
  }

  public async getPendingActions(): Promise<DbPendingAction[]> {
    await this.initialize();
    if (!this.db) return [];
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'SELECT id, tool, args_json, impact_text, status, expires_at FROM pending_actions WHERE status = "PENDING" AND expires_at > :now ORDER BY expires_at ASC'
    );
    stmt.bind({ ':now': now });
    const list: DbPendingAction[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      list.push({
        id: String(row.id),
        tool: String(row.tool),
        args_json: String(row.args_json),
        impact_text: String(row.impact_text),
        status: row.status as 'PENDING',
        expires_at: String(row.expires_at),
      });
    }
    stmt.free();
    return list;
  }

  public async getPendingAction(id: string): Promise<DbPendingAction | null> {
    await this.initialize();
    if (!this.db) return null;
    const stmt = this.db.prepare(
      'SELECT id, tool, args_json, impact_text, status, expires_at FROM pending_actions WHERE id = :id'
    );
    stmt.bind({ ':id': id });
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as DbPendingAction;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  public async updatePendingActionStatus(
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'EXPIRED'
  ): Promise<void> {
    await this.initialize();
    if (!this.db) return;
    this.db.run('UPDATE pending_actions SET status = ? WHERE id = ?', [status, id]);
    this.saveToDisk();
    await this.addAuditLog('user', `PENDING_ACTION_${status}`, { action_id: id });
  }

  /* --------------------------- TOOL CALLS -------------------------------- */

  public async recordToolCall(
    messageId: number | null,
    tool: string,
    args: Record<string, unknown>,
    risk: 'READ_ONLY' | 'LOW_RISK' | 'REQUIRES_CONFIRMATION' | 'BLOCKED_BY_DEFAULT',
    decision: 'ALLOWED' | 'CONFIRMED' | 'REJECTED' | 'BLOCKED',
    result: Record<string, unknown>
  ): Promise<void> {
    await this.initialize();
    if (!this.db) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      'INSERT INTO tool_calls (id, message_id, tool, args_json, risk, decision, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        messageId,
        tool,
        JSON.stringify(args),
        risk,
        decision,
        JSON.stringify(result),
        now,
      ]
    );
    this.saveToDisk();
  }

  /* -------------------------- SETTINGS ----------------------------------- */

  public async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    await this.initialize();
    if (!this.db) return defaultValue;
    const stmt = this.db.prepare('SELECT value_json FROM settings WHERE key = :k');
    stmt.bind({ ':k': key });
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      try {
        return JSON.parse(String(row.value_json)) as T;
      } catch {
        return defaultValue;
      }
    }
    stmt.free();
    return defaultValue;
  }

  public async setSetting(key: string, value: unknown): Promise<void> {
    await this.initialize();
    if (!this.db) return;
    this.db.run(
      'INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)',
      [key, JSON.stringify(value)]
    );
    this.saveToDisk();
  }

  public async getAllSettings(): Promise<Record<string, unknown>> {
    await this.initialize();
    if (!this.db) return {};
    const stmt = this.db.prepare('SELECT key, value_json FROM settings');
    const settings: Record<string, unknown> = {};
    while (stmt.step()) {
      const row = stmt.getAsObject();
      try {
        settings[String(row.key)] = JSON.parse(String(row.value_json));
      } catch {
        settings[String(row.key)] = String(row.value_json);
      }
    }
    stmt.free();
    return settings;
  }

  /* -------------------------- SEARCH CACHE ------------------------------- */

  public async getCachedSearch(query: string): Promise<Record<string, unknown>[] | null> {
    await this.initialize();
    if (!this.db) return null;
    const stmt = this.db.prepare('SELECT results_json FROM search_cache WHERE query = :q');
    stmt.bind({ ':q': query.trim().toLowerCase() });
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      try {
        return JSON.parse(String(row.results_json));
      } catch {
        return null;
      }
    }
    stmt.free();
    return null;
  }

  public async setCachedSearch(
    query: string,
    results: Record<string, unknown>[]
  ): Promise<void> {
    await this.initialize();
    if (!this.db) return;
    const now = new Date().toISOString();
    this.db.run(
      'INSERT OR REPLACE INTO search_cache (query, results_json, fetched_at) VALUES (?, ?, ?)',
      [query.trim().toLowerCase(), JSON.stringify(results), now]
    );
    this.saveToDisk();
  }
}

export const dbManager = new DatabaseManager();
