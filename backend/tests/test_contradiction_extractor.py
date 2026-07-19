from app.services.contradiction_extractor import build_contradiction_panel


def test_contradiction_panel_requires_source_diversity() -> None:
    panel = build_contradiction_panel(
        {
            "articles": [
                {
                    "title": "City says 12 arrests were made.",
                    "summary": "",
                    "source": "One",
                    "url": "https://one.example/a",
                }
            ]
        }
    )

    assert panel["status"] == "insufficient_source_diversity"
    assert panel["source_count"] == 1


def test_contradiction_panel_flags_numeric_disagreement() -> None:
    panel = build_contradiction_panel(
        {
            "articles": [
                {
                    "title": "Police say 12 arrests were made downtown.",
                    "summary": "Officials said the arrests followed a protest.",
                    "source": "One",
                    "url": "https://one.example/a",
                },
                {
                    "title": "Police say 9 arrests were made downtown.",
                    "summary": "Officials said the arrests followed a protest.",
                    "source": "Two",
                    "url": "https://two.example/a",
                },
                {
                    "title": "No arrests were confirmed downtown.",
                    "summary": "Officials said the protest ended late.",
                    "source": "Three",
                    "url": "https://three.example/a",
                },
            ]
        }
    )

    assert panel["status"] == "ok"
    assert panel["claims"]
    assert panel["claims"][0]["status"] == "disputed"
