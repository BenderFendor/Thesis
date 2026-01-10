from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Sequence

FIELD_KEYS = [
    "funding",
    "ownership",
    "political_bias",
    "factual_reporting",
    "editorial_stance",
    "corrections_history",
    "major_controversies",
    "reach_traffic",
    "affiliations",
    "founded",
    "headquarters",
    "official_website",
    "nonprofit_filings",
]


@dataclass(frozen=True)
class SourceDocument:
    url: str
    title: str
    text: str


def build_fields_from_documents(
    documents: Sequence[SourceDocument],
) -> Dict[str, List[Dict[str, object]]]:
    fields: Dict[str, List[Dict[str, object]]] = {key: [] for key in FIELD_KEYS}

    for document in documents:
        text = _normalize_text(document.text)
        if not text:
            continue
        source_label = _source_label(document.url)

        for value in _extract_funding_values(text):
            _append_field_unique(fields, "funding", value, [source_label])

        for value in _extract_ownership_values(text):
            _append_field_unique(fields, "ownership", value, [source_label])

        for value in _extract_editorial_stance_values(text):
            _append_field_unique(fields, "editorial_stance", value, [source_label])

        corrections_value = _extract_corrections_value(text)
        if corrections_value:
            _append_field_unique(
                fields,
                "corrections_history",
                corrections_value,
                [source_label],
            )

        for value in _extract_political_bias_values(text):
            _append_field_unique(fields, "political_bias", value, [source_label])

        for value in _extract_factual_reporting_values(text):
            _append_field_unique(fields, "factual_reporting", value, [source_label])

        for value in _extract_major_controversies(text):
            _append_field_unique(fields, "major_controversies", value, [source_label])

        for value in _extract_reach_traffic_values(text):
            _append_field_unique(fields, "reach_traffic", value, [source_label])

        for value in _extract_affiliations(text):
            _append_field_unique(fields, "affiliations", value, [source_label])

    return fields


def _normalize_text(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    return cleaned


def _source_label(url: str) -> str:
    if not url:
        return "unknown"
    return url


def _append_field_unique(
    fields: Dict[str, List[Dict[str, object]]],
    key: str,
    value: str,
    sources: List[str] | None = None,
    notes: str | None = None,
) -> None:
    cleaned = str(value or "").strip()
    if not cleaned:
        return

    entries = fields.setdefault(key, [])
    if any(str(entry.get("value", "")).lower() == cleaned.lower() for entry in entries):
        return

    entries.append(
        {
            "value": cleaned,
            "sources": sources or [],
            "notes": notes,
        }
    )


def _extract_funding_values(text: str) -> List[str]:
    values: List[str] = []
    if re.search(r"\bnon[- ]?profit\b|\bnot[- ]?for[- ]?profit\b|\b501\(c\)\(3\)\b", text, re.I):
        _append_unique(values, "non-profit")
    if re.search(r"reader[- ]supported|supported by readers|supported by reader", text, re.I):
        _append_unique(values, "reader-supported")
    if re.search(r"reader donations", text, re.I):
        _append_unique(values, "reader-supported")
    if re.search(r"member[- ]supported", text, re.I):
        _append_unique(values, "member-supported")
    if re.search(r"donations?", text, re.I):
        _append_unique(values, "donation-supported")
    if re.search(r"foundation(s)?|grant(s)?", text, re.I):
        _append_unique(values, "foundation funding")
    no_ads = re.search(r"no advertising|does not accept advertising", text, re.I)
    if no_ads:
        _append_unique(values, "no advertising")
    if not no_ads and re.search(r"\badvertising\b", text, re.I):
        _append_unique(values, "advertising-supported")
    if re.search(r"subscription(s)?", text, re.I):
        _append_unique(values, "subscription-supported")
    if re.search(r"membership", text, re.I):
        _append_unique(values, "member-supported")
    return values


def _extract_editorial_stance_values(text: str) -> List[str]:
    values: List[str] = []
    if re.search(r"\bindependent\b", text, re.I):
        _append_unique(values, "independent")
    if re.search(r"social justice", text, re.I):
        _append_unique(values, "social justice focus")
    if re.search(r"\bprogressive\b", text, re.I):
        _append_unique(values, "progressive")
    if re.search(r"\badvocacy\b", text, re.I):
        _append_unique(values, "advocacy journalism")
    if re.search(r"\bmission\b", text, re.I):
        _append_unique(values, "mission-led")
    return values


def _extract_corrections_value(text: str) -> str | None:
    if re.search(r"corrections? policy", text, re.I):
        return "Corrections policy published"
    if re.search(r"corrections?", text, re.I) and re.search(r"errors?|mistakes?", text, re.I):
        return "Corrections process mentioned"
    return None


def _extract_political_bias_values(text: str) -> List[str]:
    values: List[str] = []
    patterns = [
        r"\bbias rating\s*:\s*(left|right|center[- ]left|center[- ]right|center)\b",
        r"\b(left|right|center[- ]left|center[- ]right|center)\s+bias\b",
        r"\bpolitical\s+bias\s*:\s*(left|right|center[- ]left|center[- ]right|center)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            _append_unique(values, match.group(1).lower().replace(" ", "-"))
            break
    if re.search(r"\bleft[- ]wing\b", text, re.I):
        _append_unique(values, "left-wing")
    if re.search(r"\bright[- ]wing\b", text, re.I):
        _append_unique(values, "right-wing")
    if re.search(r"\bcenter[- ]left\b", text, re.I):
        _append_unique(values, "center-left")
    if re.search(r"\bcenter[- ]right\b", text, re.I):
        _append_unique(values, "center-right")
    return values


def _extract_factual_reporting_values(text: str) -> List[str]:
    values: List[str] = []
    match = re.search(
        r"\bfactual reporting\s*:\s*(very high|high|mixed|low|very low|mostly factual)\b",
        text,
        re.I,
    )
    if match:
        _append_unique(values, _normalize_rating(match.group(1)))
        return values
    match = re.search(
        r"\breliability\s*:\s*(generally reliable|mixed reliability|low reliability|high reliability)\b",
        text,
        re.I,
    )
    if match:
        _append_unique(values, match.group(1).lower().replace(" ", "-"))
    return values


def _extract_ownership_values(text: str) -> List[str]:
    values: List[str] = []
    patterns = [
        r"owned by ([A-Za-z][A-Za-z0-9&,.\-\s]{2,60}?)(?:[.;,\n]|$)",
        r"subsidiary of ([A-Za-z][A-Za-z0-9&,.\-\s]{2,60}?)(?:[.;,\n]|$)",
        r"parent company (?:is )?([A-Za-z][A-Za-z0-9&,.\-\s]{2,60}?)(?:[.;,\n]|$)",
        r"part of ([A-Za-z][A-Za-z0-9&,.\-\s]{2,60}?)(?:[.;,\n]|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            _append_unique(values, match.group(1).strip().rstrip("."))
            break
    return values


def _extract_reach_traffic_values(text: str) -> List[str]:
    values: List[str] = []
    match = re.search(
        r"\b([0-9][0-9,]*\s*(million|billion)?\s*(readers|visitors|subscribers|monthly visitors|monthly readers))\b",
        text,
        re.I,
    )
    if match:
        _append_unique(values, match.group(1).lower())
    return values


def _extract_affiliations(text: str) -> List[str]:
    values: List[str] = []
    patterns = [
        r"member of ([A-Za-z][A-Za-z0-9&,.\-\s]{2,60}?)(?:[.;,\n]|$)",
        r"affiliated with ([A-Za-z][A-Za-z0-9&,.\-\s]{2,60}?)(?:[.;,\n]|$)",
        r"in partnership with ([A-Za-z][A-Za-z0-9&,.\-\s]{2,60}?)(?:[.;,\n]|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            _append_unique(values, match.group(1).strip().rstrip("."))
    return values


def _extract_major_controversies(text: str) -> List[str]:
    values: List[str] = []
    for sentence in _sentences(text):
        if not re.search(r"controvers", sentence, re.I):
            continue
        match = re.search(
            r"controvers(?:y|ial)(?:\s+reporting)?\s+on\s+([A-Z][^.;:]{1,80})",
            sentence,
            re.I,
        )
        if match:
            label = match.group(1).strip()
            values.append(f"Controversial reporting on {label}")
            continue
        values.append(_trim_words(sentence, 8))
    return values


def _sentences(text: str) -> List[str]:
    return [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", text) if segment.strip()]


def _trim_words(text: str, limit: int) -> str:
    words = text.split()
    if len(words) <= limit:
        return text
    return " ".join(words[:limit])


def _append_unique(values: List[str], value: str) -> None:
    if value not in values:
        values.append(value)


def _normalize_rating(value: str) -> str:
    cleaned = value.strip().lower()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.replace(" ", "-")
