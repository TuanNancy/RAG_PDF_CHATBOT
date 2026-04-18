"""
Allowed chat models for the MVP model switcher.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ChatModelOption:
    id: str
    label: str


CHAT_MODEL_OPTIONS: tuple[ChatModelOption, ...] = (
    ChatModelOption(id="google/gemini-2.0-flash-lite-001", label="Nhanh"),
    ChatModelOption(id="openai/gpt-4o-mini", label="Can bang"),
    ChatModelOption(id="anthropic/claude-3.5-haiku", label="Chat luong cao"),
)


def get_allowed_chat_model_ids() -> set[str]:
    return {option.id for option in CHAT_MODEL_OPTIONS}
