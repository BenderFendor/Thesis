from __future__ import annotations

from hypothesis import given, strategies as st

from app.models.verification import ConfidenceLevel
from app.services.verification_output import _confidence_to_level


def _rank(level: ConfidenceLevel) -> int:
    return {
        ConfidenceLevel.VERY_LOW: 0,
        ConfidenceLevel.LOW: 1,
        ConfidenceLevel.MEDIUM: 2,
        ConfidenceLevel.HIGH: 3,
    }[level]


@given(st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False))
def test_confidence_to_level_respects_thresholds(confidence: float) -> None:
    level = _confidence_to_level(confidence)

    if confidence >= 0.8:
        assert level == ConfidenceLevel.HIGH
    elif confidence >= 0.5:
        assert level == ConfidenceLevel.MEDIUM
    elif confidence >= 0.2:
        assert level == ConfidenceLevel.LOW
    else:
        assert level == ConfidenceLevel.VERY_LOW


@given(
    st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
)
def test_confidence_to_level_is_monotonic(a: float, b: float) -> None:
    low, high = sorted((a, b))
    assert _rank(_confidence_to_level(low)) <= _rank(_confidence_to_level(high))
