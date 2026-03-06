from typing import Sequence

class BM25Okapi:
    def __init__(
        self,
        corpus: Sequence[Sequence[str]],
        *,
        k1: float = ...,
        b: float = ...,
        epsilon: float = ...,
    ) -> None: ...
    def get_scores(self, query_tokens: Sequence[str]) -> list[float]: ...
