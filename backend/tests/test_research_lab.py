from __future__ import annotations

import json

from tools import research_lab


def test_load_queries_file_supports_json_and_newline_formats(tmp_path) -> None:
    json_path = tmp_path / "queries.json"
    json_path.write_text(
        json.dumps({"queries": [" one ", "two", ""]}), encoding="utf-8"
    )

    text_path = tmp_path / "queries.txt"
    text_path.write_text("alpha\n\n beta \n", encoding="utf-8")

    assert research_lab._load_queries_file(str(json_path)) == ["one", "two"]
    assert research_lab._load_queries_file(str(text_path)) == ["alpha", "beta"]


def test_build_summary_reports_tool_coverage_and_history_failures() -> None:
    results = [
        {
            "query": "turn one",
            "completed": True,
            "has_sections": True,
            "error": None,
            "stopped_early": False,
            "elapsed_seconds": 4.0,
            "time_to_first_event": 0.5,
            "tool_calls": 2,
            "tool_sequence": [
                {"tool": "search_internal_news", "args": {}},
                {"tool": "gdelt_context_search", "args": {}},
            ],
            "executed_tool_calls": 2,
            "executed_tools": [
                "search_internal_news",
                "gdelt_context_search",
            ],
            "history_messages_sent": 0,
            "source_providers": ["internal", "gdelt"],
            "answer": "Answer\nExample",
        },
        {
            "query": "turn two",
            "completed": True,
            "has_sections": True,
            "error": None,
            "stopped_early": False,
            "elapsed_seconds": 6.0,
            "time_to_first_event": 1.5,
            "tool_calls": 0,
            "executed_tool_calls": 1,
            "tool_sequence": [],
            "executed_tools": ["news_search"],
            "history_messages_sent": 2,
            "source_providers": [],
            "answer": (
                "I do not have access to the specific sources or internal URLs "
                "I used previously."
            ),
        },
    ]

    summary = research_lab._build_summary(results)

    assert summary["completed"] == 2
    assert summary["failures"] == 0
    assert summary["avg_elapsed_seconds"] == 5.0
    assert summary["avg_tool_calls"] == 1.0
    assert summary["avg_executed_tool_calls"] == 1.5
    assert summary["unique_tools"] == [
        "gdelt_context_search",
        "news_search",
        "search_internal_news",
    ]
    assert summary["unique_requested_tools"] == [
        "gdelt_context_search",
        "search_internal_news",
    ]
    assert summary["tool_usage_counts"] == {
        "gdelt_context_search": 1,
        "news_search": 1,
        "search_internal_news": 1,
    }
    assert summary["requested_tool_usage_counts"] == {
        "gdelt_context_search": 1,
        "search_internal_news": 1,
    }
    assert "news_search" not in summary["missing_registered_tools"]
    assert "web_search" in summary["missing_registered_tools"]
    assert summary["source_provider_counts"] == {"gdelt": 1, "internal": 1}
    assert summary["queries_without_tool_calls"] == ["turn two"]
    assert summary["history_recall_failures"] == ["turn two"]


def test_resolve_final_answer_ignores_trailing_tool_request_steps() -> None:
    assert (
        research_lab._resolve_final_answer(
            {},
            [
                {"type": "thought", "content": "Answer\nPartial answer"},
                {"type": "tool_start", "content": "Tool request: web_search {}"},
            ],
        )
        == "Answer\nPartial answer"
    )
