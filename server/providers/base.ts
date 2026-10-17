export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIProvider {
  name: string;
  generateReply(
    systemInstruction: string,
    history: ChatMessage[],
    newMessage: string,
    timeoutSeconds: number
  ): Promise<string>;
  checkHealth(): Promise<boolean>;
}
