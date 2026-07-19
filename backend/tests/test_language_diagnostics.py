"""Tests for deterministic article language diagnostics."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services.language_diagnostics import analyze_language_diagnostics


def test_language_diagnostics_flags_passive_actor_omission_and_euphemisms() -> None:
    text = (
        "The neighborhood was struck before dawn. "
        "Five residents were killed during what officials called a surgical strike. "
        "The ministry said collateral damage was regrettable. "
        "Witnesses said the army fired from the ridge."
    )

    diagnostics = analyze_language_diagnostics(text)

    assert diagnostics["sentence_count"] == 4
    assert diagnostics["passive_voice"]["count"] >= 2
    assert diagnostics["actor_omission"]["count"] >= 1
    assert diagnostics["euphemisms"]["count"] == 2
    assert diagnostics["overall"]["status"] in {"medium", "high"}
    assert diagnostics["actor_omission"]["examples"][0]["pattern"] == "passive without named actor"


def test_language_diagnostics_stays_low_for_direct_attributed_language() -> None:
    text = (
        "The city council approved the budget after a public vote. "
        "The mayor signed the ordinance on Tuesday. "
        "Residents criticized the spending plan during the hearing."
    )

    diagnostics = analyze_language_diagnostics(text)

    assert diagnostics["passive_voice"]["count"] == 0
    assert diagnostics["actor_omission"]["count"] == 0
    assert diagnostics["euphemisms"]["count"] == 0
    assert diagnostics["overall"]["status"] == "low"


def test_language_diagnostics_endpoint_accepts_inline_text() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/article/language-diagnostics",
        json={
            "url": "https://example.com/story",
            "title": "Example story",
            "text": "People were detained overnight. Officials described unrest near the square.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["article_url"] == "https://example.com/story"
    assert payload["title"] == "Example story"
    assert payload["actor_omission"]["count"] == 1
    assert payload["sanitized_language"]["count"] == 1
