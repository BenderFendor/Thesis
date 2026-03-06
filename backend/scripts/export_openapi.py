from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    source_url = os.getenv("OPENAPI_URL", "http://localhost:8000/openapi.json")
    output_path = BACKEND_ROOT / "openapi.json"

    try:
        with urllib.request.urlopen(source_url, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Failed to download OpenAPI schema from {source_url}"
        ) from exc

    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote OpenAPI schema to {output_path} from {source_url}")


if __name__ == "__main__":
    main()
