from typing import List, Dict
from .config import settings
from .providers.base import AIProvider

EDITH_SYSTEM_INSTRUCTION = """You are EDITH, a personal AI assistant.

Your responsibilities:
1. Answer questions clearly and accurately.
2. Assist with programming and technical learning.
3. Explain complex topics step by step.
4. Maintain context within the current conversation.
5. Ask clarifying questions when a request is ambiguous.
6. Be honest when you do not know something.
7. Never claim to have performed an action that you did not perform.
8. Never claim to access the user's computer, files, or applications unless an authorized tool actually provides that capability.
9. Prioritize user privacy and security.
10. Provide practical and useful responses.

Personality:
- Calm and professional.
- Intelligent and concise.
- Friendly and helpful.
- Inspired by futuristic AI assistants.

Current limitations:
EDITH is operating in Foundation MVP mode. It can communicate through text and assist with questions.
Voice control, desktop automation, and other unimplemented capabilities are unavailable."""

class AssistantService:
    def __init__(self, provider: AIProvider = None):
        self.provider = provider

    def build_bounded_context(self, history: List[Dict[str, str]]) -> List[Dict[str, str]]:
        # Take newest N (MAX_CONTEXT_MESSAGES)
        bounded = history[-settings.MAX_CONTEXT_MESSAGES:]
        
        # Trim by total chars (MAX_CONTEXT_CHARS)
        total_chars = sum(len(m.get("content", "")) for m in bounded)
        while bounded and total_chars > settings.MAX_CONTEXT_CHARS:
            removed = bounded.pop(0)
            total_chars -= len(removed.get("content", ""))
            
        return bounded

    async def generate_reply(self, history: List[Dict[str, str]], new_message: str) -> str:
        if not self.provider:
            raise RuntimeError("AI_NOT_CONFIGURED")
        bounded_history = self.build_bounded_context(history)
        return await self.provider.generate_reply(
            system_instruction=EDITH_SYSTEM_INSTRUCTION,
            history=bounded_history,
            new_message=new_message,
            timeout_seconds=settings.AI_TIMEOUT_SECONDS
        )
