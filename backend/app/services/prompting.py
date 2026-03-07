from __future__ import annotations

from datetime import datetime, timezone

COPY_STYLE_GUIDE = (
    "Write direct prose. Keep sentences short and plain. Use a modern, casual tone. "
    "Do not use emojis or em dashes. Avoid expectation flips and contrast framing. "
    "Do not add meta commentary about the writing process. Do not write listicles "
    "or stack fragments. Do not claim that facts show or reveal anything. Do not "
    "use the following words in prose unless they are part of quoted source "
    "material, fixed field names, or required schema keys: align, crucial, delve, "
    "emphasize, enduring, enhance, fostering, garnered, highlight, interplay, "
    "intricate, pivotal, showcase, tapestry, underscore. Keep qualifiers light and "
    "avoid jargon."
)

FACT_GROUNDING_RULES = (
    "Use the provided context first. Do not invent facts. If something is "
    "uncertain, say so plainly. Cite URLs when they are available."
)

PROVIDED_CONTEXT_ONLY_RULES = (
    "Use the provided context only. Do not add outside facts unless the task "
    "explicitly asks for broader research. If the context is incomplete, note the "
    "gap plainly."
)

TEXT_OUTPUT_RULES = "Respond with detailed prose that stays concise and well-written."
JSON_OUTPUT_RULES = "Return valid JSON only. No markdown fences or extra prose."
ANSWER_SECTION_RULE = "Respond with a section titled 'Answer'."


def current_date_string() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def build_assistant_identity(role: str) -> str:
    return f"Current date is {current_date_string()}. You are Scoop's {role}."


def compose_prompt_blocks(*blocks: str) -> str:
    return "\n\n".join(block.strip() for block in blocks if block and block.strip())


def build_text_system_prompt(
    *,
    role: str,
    task: str,
    grounding_rules: str = FACT_GROUNDING_RULES,
    output_rules: str = TEXT_OUTPUT_RULES,
) -> str:
    return compose_prompt_blocks(
        build_assistant_identity(role),
        task,
        grounding_rules,
        COPY_STYLE_GUIDE,
        output_rules,
    )


def build_json_system_prompt(
    *,
    role: str,
    task: str,
    grounding_rules: str = FACT_GROUNDING_RULES,
    output_rules: str = JSON_OUTPUT_RULES,
) -> str:
    return compose_prompt_blocks(
        build_assistant_identity(role),
        task,
        grounding_rules,
        COPY_STYLE_GUIDE,
        output_rules,
    )
