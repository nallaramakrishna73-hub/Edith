from typing import Optional, List, Literal
from pydantic import BaseModel, Field

class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str = Field(..., min_length=1, max_length=4000)

class ChatResponse(BaseModel):
    conversation_id: str
    reply: str
    status: Literal["success"] = "success"

class MessageOut(BaseModel):
    id: int
    conversation_id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: str

class ConversationSummaryOut(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    message_count: int

class ConversationDetailOut(BaseModel):
    conversation: ConversationSummaryOut
    messages: List[MessageOut]

class StatusAiResponse(BaseModel):
    status: Literal["ready", "unavailable", "not_configured"]
    provider: str
    model: str

class StatusResponse(BaseModel):
    app: str = "EDITH"
    version: str = "1.0.0"
    environment: str = "development"
    backend: dict
    database: dict
    ai: StatusAiResponse
