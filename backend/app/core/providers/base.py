from abc import ABC, abstractmethod
from typing import List, Dict

class AIProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @abstractmethod
    async def generate_reply(
        self,
        system_instruction: str,
        history: List[Dict[str, str]],
        new_message: str,
        timeout_seconds: int
    ) -> str:
        pass

    @abstractmethod
    async def check_health(self) -> bool:
        pass
