"""Keep Zen's public reasoning fields and project LangGraph message events."""

from collections.abc import Iterator
from typing import Any

from langchain_core.messages import AIMessageChunk, BaseMessageChunk
from langchain_core.outputs import ChatGenerationChunk
from langchain_openai import ChatOpenAI


class ResearchChatOpenAI(ChatOpenAI):
    """OpenAI-compatible gateway with provider-exposed reasoning metadata."""

    def _convert_chunk_to_generation_chunk(
        self,
        chunk: dict[str, Any],
        default_chunk_class: type[BaseMessageChunk],
        base_generation_info: dict[str, Any] | None,
    ) -> ChatGenerationChunk | None:
        result = super()._convert_chunk_to_generation_chunk(
            chunk, default_chunk_class, base_generation_info
        )
        choices = chunk.get("choices", [])
        if result is not None and choices:
            delta = choices[0].get("delta") or {}
            result.message.additional_kwargs.update(
                (key, delta[key])
                for key in ("reasoning", "reasoning_content", "reasoning_details")
                if delta.get(key) is not None
            )
        return result


def model_delta_events(message: Any) -> Iterator[dict[str, Any]]:
    """Only model text/reasoning chunks become visible deltas, not tool output."""
    if not isinstance(message, AIMessageChunk):
        return
    reasoning = message.additional_kwargs.get("reasoning") or message.additional_kwargs.get(
        "reasoning_content", ""
    )
    content = message.content if isinstance(message.content, str) else message.text
    if content or reasoning:
        yield {
            "type": "model_delta",
            "message_id": message.id or "model",
            "content": content,
            "reasoning": reasoning,
        }
