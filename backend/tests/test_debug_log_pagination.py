from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

from hypothesis import given, strategies as st

from app.api.routes.debug import _read_jsonl_tail


@given(
    entries=st.lists(st.integers(), min_size=1, max_size=30),
    limit=st.integers(min_value=1, max_value=15),
    offset=st.integers(min_value=0, max_value=20),
)
def test_read_jsonl_tail_pages_backwards_from_newest(
    entries: list[int],
    limit: int,
    offset: int,
) -> None:
    with TemporaryDirectory() as temp_dir:
        path = Path(temp_dir) / "llm_calls.log"
        with path.open("w", encoding="utf-8") as handle:
            for index, value in enumerate(entries):
                handle.write(json.dumps({"index": index, "value": value}) + "\n")

        payload = _read_jsonl_tail(path, limit=limit, offset=offset)

        end = max(len(entries) - offset, 0)
        start = max(end - limit, 0)
        expected = [
            {"index": index, "value": value}
            for index, value in enumerate(entries[start:end], start=start)
        ]

        assert payload["entries"] == expected
        assert payload["returned"] == len(expected)
        assert payload["total"] == len(entries)
