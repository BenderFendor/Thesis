import json
from pathlib import Path
from typing import Dict, Any

_DATA_PATH = Path(__file__).with_name("rss_sources.json")

with _DATA_PATH.open("r", encoding="utf-8") as _source_file:
    RSS_SOURCES: Dict[str, Any] = json.load(_source_file)


def get_rss_sources() -> Dict[str, Any]:
    """Return a shallow copy of the RSS sources configuration."""
    return dict(RSS_SOURCES)
