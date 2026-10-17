import { config } from './config.ts';
import type { AIProvider, ChatMessage } from './providers/base.ts';
import { defaultProvider } from './providers/gemini.ts';
import { TOOL_REGISTRY } from './tools/registry.ts';
import { permissionEngine } from './permissions/engine.ts';
import { dbManager, DbPendingAction } from './database.ts';

export const EDITH_SYSTEM_INSTRUCTION = `You are EDITH (Enhanced Digital Intelligence & Tactical Helper), a JARVIS-inspired AI personal assistant and operating environment running on Kali Linux.

Your core capabilities include:
1. Voice and text conversation with crisp, calm, and concise responses.
2. Answering technical and defensive cybersecurity questions.
3. Access to approved tools through the EDITH Permission Engine:
   - get_system_status: Check CPU, RAM, disk, network, and processes.
   - web_search: Real-time web research with citations and source links (args: {"query": "..."}).
   - open_application: Launch allowlisted apps: firefox, code, terminal, file_manager, wireshark, burpsuite (args: {"app_id": "..."}).
   - open_folder: Open authorized folders (args: {"folder_path": "..."}).
   - create_note: Create workspace notes (args: {"filename": "...", "content": "..."}).
   - delete_files: Delete workspace files (REQUIRES USER CONFIRMATION; args: {"targets": "..."}).
   - run_security_scan: Defensive port scans on authorized targets (REQUIRES USER CONFIRMATION; args: {"target": "..."}).

RULES FOR TOOL CALLING:
- If the user's intent clearly matches a tool (e.g. "check my RAM", "what is my CPU", "open VS Code", "open Firefox", "search for...", "create a note called...", "delete the file..."), you MUST invoke the tool by prefixing your reply with a JSON tool call block in the following exact format:
:::tool_call
{"tool": "TOOL_NAME", "args": { ... }}
:::
- Never claim to have performed an action without calling the tool.
- If an action requires confirmation (like deleting files or security scans), EDITH informs the user what was prepared and asks for approval.
- Keep spoken responses punchy, concise, and professional.`;

export interface AssistantResponse {
  reply: string;
  toolCall?: {
    tool: string;
    args: Record<string, unknown>;
    result?: Record<string, unknown>;
    risk?: string;
    status: 'EXECUTED' | 'REQUIRES_CONFIRMATION' | 'BLOCKED';
  };
  pendingAction?: DbPendingAction;
  sources?: Array<{ title: string; url: string; snippet?: string }>;
}

export class AssistantService {
  private provider: AIProvider;

  constructor(provider: AIProvider = defaultProvider) {
    this.provider = provider;
  }

  public setProvider(provider: AIProvider): void {
    this.provider = provider;
  }

  public getProvider(): AIProvider {
    return this.provider;
  }

  public buildBoundedContext(rawMessages: ChatMessage[]): ChatMessage[] {
    const maxMessages = config.MAX_CONTEXT_MESSAGES;
    const boundedCount = rawMessages.slice(-maxMessages);
    const maxChars = config.MAX_CONTEXT_CHARS;
    const trimmed: ChatMessage[] = [...boundedCount];

    let totalChars = trimmed.reduce((acc, msg) => acc + msg.content.length, 0);
    while (trimmed.length > 0 && totalChars > maxChars) {
      const removed = trimmed.shift();
      if (removed) {
        totalChars -= removed.content.length;
      }
    }

    return trimmed;
  }

  public async generateReply(
    historyMessages: ChatMessage[],
    newUserMessage: string
  ): Promise<AssistantResponse> {
    const trimmedInput = newUserMessage.trim().toLowerCase();

    // 1. Check for spoken or typed approval of pending action ("yes", "approve", "confirm")
    if (trimmedInput === 'yes' || trimmedInput === 'approve' || trimmedInput === 'confirm' || trimmedInput === 'proceed') {
      const pendingList = await dbManager.getPendingActions();
      if (pendingList.length > 0) {
        const mostRecent = pendingList[0];
        const toolDef = TOOL_REGISTRY[mostRecent.tool];
        if (toolDef) {
          const args = JSON.parse(mostRecent.args_json);
          const execRes = await permissionEngine.evaluateAndExecute(toolDef, args, true);
          await dbManager.updatePendingActionStatus(mostRecent.id, 'APPROVED');

          return {
            reply: `Action confirmed and executed: ${mostRecent.impact_text}. Result: ${execRes.result?.message || 'Completed successfully.'}`,
            toolCall: {
              tool: mostRecent.tool,
              args,
              result: execRes.result,
              status: 'EXECUTED',
            },
          };
        }
      }
    }

    // 2. Query LLM with bounded context
    const boundedHistory = this.buildBoundedContext(historyMessages);
    const rawReply = await this.provider.generateReply(
      EDITH_SYSTEM_INSTRUCTION,
      boundedHistory,
      newUserMessage,
      config.AI_TIMEOUT_SECONDS
    );

    // 3. Check for tool call block in response
    const toolCallRegex = /:::tool_call\s*([\s\S]*?)\s*:::/;
    const match = toolCallRegex.exec(rawReply);

    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        const toolName = parsed.tool;
        const toolArgs = parsed.args || {};

        const toolDef = TOOL_REGISTRY[toolName];
        if (!toolDef) {
          return {
            reply: rawReply.replace(toolCallRegex, '').trim() || `Tool '${toolName}' is not recognized.`,
          };
        }

        // Pass through Permission Engine
        const evaluation = await permissionEngine.evaluateAndExecute(toolDef, toolArgs);

        let cleanText = rawReply.replace(toolCallRegex, '').trim();

        if (evaluation.status === 'REQUIRES_CONFIRMATION') {
          return {
            reply: cleanText || `Action requires your authorization: ${evaluation.pendingAction?.impact_text}. Please approve in the prompt.`,
            pendingAction: evaluation.pendingAction,
            toolCall: {
              tool: toolName,
              args: toolArgs,
              status: 'REQUIRES_CONFIRMATION',
            },
          };
        }

        if (evaluation.status === 'BLOCKED') {
          return {
            reply: cleanText || evaluation.message || `Action '${toolName}' was blocked by safety policy.`,
            toolCall: {
              tool: toolName,
              args: toolArgs,
              status: 'BLOCKED',
            },
          };
        }

        // Tool was EXECUTED (READ_ONLY or LOW_RISK)
        let sources: Array<{ title: string; url: string; snippet?: string }> | undefined;
        if (toolName === 'web_search' && evaluation.result?.results) {
          sources = evaluation.result.results as Array<{ title: string; url: string; snippet?: string }>;
        }

        const resultSummary = evaluation.result?.message || evaluation.result?.summary || JSON.stringify(evaluation.result);

        return {
          reply: cleanText ? `${cleanText}\n\n${resultSummary}` : String(resultSummary),
          toolCall: {
            tool: toolName,
            args: toolArgs,
            result: evaluation.result,
            status: 'EXECUTED',
          },
          sources,
        };
      } catch (err) {
        console.error('Tool execution error:', err);
      }
    }

    return {
      reply: rawReply.replace(toolCallRegex, '').trim() || rawReply,
    };
  }
}

export const assistantService = new AssistantService();
