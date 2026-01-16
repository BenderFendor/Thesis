"""
Verification output formatters.

Generates markdown reports with inline footnotes and structured JSON
for frontend consumption.
"""

from __future__ import annotations

from typing import Dict, List

from app.models.verification import (
    ConfidenceLevel,
    SourceInfo,
    VerifiedClaim,
)


def _confidence_emoji(level: ConfidenceLevel) -> str:
    """Get text indicator for confidence level (no emojis per project rules)."""
    return {
        ConfidenceLevel.HIGH: "[HIGH]",
        ConfidenceLevel.MEDIUM: "[MEDIUM]",
        ConfidenceLevel.LOW: "[LOW]",
        ConfidenceLevel.VERY_LOW: "[VERY LOW]",
    }.get(level, "[?]")


def _confidence_color(level: ConfidenceLevel) -> str:
    """Get CSS color class for confidence level."""
    return {
        ConfidenceLevel.HIGH: "text-green-600",
        ConfidenceLevel.MEDIUM: "text-yellow-600",
        ConfidenceLevel.LOW: "text-orange-600",
        ConfidenceLevel.VERY_LOW: "text-red-600",
    }.get(level, "text-gray-600")


def format_markdown_report(
    claims: List[VerifiedClaim],
    sources: Dict[str, SourceInfo],
    overall_confidence: float,
) -> str:
    """
    Format verification results as markdown with inline footnotes.

    Output structure:
    - Overall confidence summary
    - Per-claim verification status with footnote references
    - Footnotes section with source details
    """
    if not claims:
        return "No claims were verified."

    lines = []

    overall_level = _confidence_to_level(overall_confidence)
    lines.append(f"## Verification Summary")
    lines.append("")
    lines.append(
        f"**Overall Confidence:** {overall_confidence:.0%} {_confidence_emoji(overall_level)}"
    )
    lines.append("")

    lines.append("## Verified Claims")
    lines.append("")

    footnote_map: Dict[str, int] = {}
    footnote_counter = 0

    for claim in claims:
        indicator = _confidence_emoji(claim.confidence_level)
        lines.append(f"- {indicator} {claim.claim_text}")

        footnote_refs = []
        for source_id in claim.supporting_sources + claim.conflicting_sources:
            if source_id not in footnote_map:
                footnote_counter += 1
                footnote_map[source_id] = footnote_counter
            footnote_refs.append(f"[^{footnote_map[source_id]}]")

        if footnote_refs:
            lines[-1] += " " + "".join(footnote_refs)

        if claim.needs_recheck and claim.recheck_reason:
            lines.append(f"  - *Note: {claim.recheck_reason}*")

        lines.append("")

    if footnote_map:
        lines.append("## Sources")
        lines.append("")

        for source_id, footnote_num in sorted(footnote_map.items(), key=lambda x: x[1]):
            source = sources.get(source_id)
            if not source:
                continue

            title = source.title or source.domain
            support_text = "supports" if source.supports_claim else "contradicts"
            cred_pct = f"{source.credibility_score:.0%}"

            lines.append(
                f"[^{footnote_num}]: [{title}]({source.url}) "
                f"({support_text}, credibility: {cred_pct})"
            )

    return "\n".join(lines)


def format_claims_with_annotations(
    original_text: str,
    claims: List[VerifiedClaim],
) -> str:
    """
    Return original text with claim annotations inserted.

    Wraps verified claims in <span> tags with data attributes
    for frontend highlighting.
    """
    if not claims:
        return original_text

    annotated = original_text

    for claim in sorted(claims, key=lambda c: len(c.claim_text), reverse=True):
        if claim.claim_text not in annotated:
            continue

        level_class = _confidence_color(claim.confidence_level)
        annotation = (
            f'<span class="verified-claim {level_class}" '
            f'data-claim-id="{claim.id}" '
            f'data-confidence="{claim.confidence:.2f}" '
            f'data-level="{claim.confidence_level.value}">'
            f"{claim.claim_text}"
            f"</span>"
        )

        annotated = annotated.replace(claim.claim_text, annotation, 1)

    return annotated


def format_json_response(
    claims: List[VerifiedClaim],
    sources: Dict[str, SourceInfo],
    overall_confidence: float,
) -> Dict:
    """
    Format verification results as structured JSON for frontend.

    Includes:
    - Summary statistics
    - Claim list with confidence levels
    - Source details keyed by ID
    """
    high_count = sum(1 for c in claims if c.confidence_level == ConfidenceLevel.HIGH)
    medium_count = sum(
        1 for c in claims if c.confidence_level == ConfidenceLevel.MEDIUM
    )
    low_count = sum(
        1
        for c in claims
        if c.confidence_level in (ConfidenceLevel.LOW, ConfidenceLevel.VERY_LOW)
    )

    return {
        "summary": {
            "overall_confidence": overall_confidence,
            "overall_level": _confidence_to_level(overall_confidence).value,
            "total_claims": len(claims),
            "high_confidence": high_count,
            "medium_confidence": medium_count,
            "low_confidence": low_count,
            "total_sources": len(sources),
        },
        "claims": [
            {
                "id": c.id,
                "text": c.claim_text,
                "confidence": c.confidence,
                "level": c.confidence_level.value,
                "supporting_sources": c.supporting_sources,
                "conflicting_sources": c.conflicting_sources,
                "needs_recheck": c.needs_recheck,
                "recheck_reason": c.recheck_reason,
            }
            for c in claims
        ],
        "sources": {
            sid: {
                "id": s.id,
                "url": s.url,
                "title": s.title,
                "domain": s.domain,
                "credibility": s.credibility_score,
                "type": s.source_type.value,
                "supports_claim": s.supports_claim,
                "excerpt": s.excerpt,
            }
            for sid, s in sources.items()
        },
    }


def _confidence_to_level(confidence: float) -> ConfidenceLevel:
    """Convert numeric confidence to level."""
    if confidence >= 0.8:
        return ConfidenceLevel.HIGH
    if confidence >= 0.5:
        return ConfidenceLevel.MEDIUM
    if confidence >= 0.2:
        return ConfidenceLevel.LOW
    return ConfidenceLevel.VERY_LOW
