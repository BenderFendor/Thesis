"""
Read-only sandbox workspace for verification agent.

Safety constraints:
- Temp workspace in /tmp/thesis_verification/{session_id}/
- Read-only access to project files
- No bash execution
- No credential file access
- Network requests only to whitelisted domains
- Session isolation with automatic cleanup
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlparse

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("verification_sandbox")

PROJECT_ROOT = Path("/home/bender/classwork/Thesis")
ALLOWED_READ_PATHS = {
    PROJECT_ROOT / "backend" / "app",
    PROJECT_ROOT / "frontend" / "lib",
    PROJECT_ROOT / "frontend" / "components",
}
BLOCKED_PATTERNS = {
    r"\.env",
    r"credentials",
    r"secrets",
    r"\.git",
    r"node_modules",
    r"__pycache__",
    r"\.pyc$",
}


class SandboxSecurityError(Exception):
    """Raised when a sandbox security constraint is violated."""

    pass


class VerificationSandbox:
    """
    Read-only workspace for verification research artifacts.

    Provides:
    - Isolated temp directory per session
    - Write access only to workspace
    - Read access to whitelisted project paths
    - Network request filtering
    - Automatic cleanup
    """

    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id or self._generate_session_id()
        self.workspace_dir = Path(settings.verification_workspace_dir) / self.session_id
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self.created_at = datetime.now(timezone.utc)
        self.artifacts: List[str] = []
        self._allowed_domains: Set[str] = set(settings.verification_allowed_domains)
        logger.info(
            "Verification sandbox created: session=%s workspace=%s",
            self.session_id,
            self.workspace_dir,
        )

    def _generate_session_id(self) -> str:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        random_suffix = hashlib.sha256(os.urandom(16)).hexdigest()[:8]
        return f"verify_{timestamp}_{random_suffix}"

    def _is_path_blocked(self, path: Path) -> bool:
        path_str = str(path)
        for pattern in BLOCKED_PATTERNS:
            if re.search(pattern, path_str):
                return True
        return False

    def _is_read_allowed(self, path: Path) -> bool:
        resolved = path.resolve()
        if self._is_path_blocked(resolved):
            return False
        if resolved.is_relative_to(self.workspace_dir):
            return True
        for allowed_path in ALLOWED_READ_PATHS:
            if resolved.is_relative_to(allowed_path):
                return True
        return False

    def is_domain_allowed(self, url: str) -> bool:
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            domain = domain.split(":")[0]
            for allowed in self._allowed_domains:
                if domain == allowed or domain.endswith(f".{allowed}"):
                    return True
            return False
        except Exception:
            return False

    def read_file(self, path: str | Path) -> str:
        """
        Read a file if path is within allowed boundaries.

        Raises SandboxSecurityError if path is blocked.
        """
        resolved = Path(path).resolve()
        if not self._is_read_allowed(resolved):
            raise SandboxSecurityError(
                f"Read access denied: {path} is outside sandbox boundaries"
            )
        if not resolved.exists():
            raise FileNotFoundError(f"File not found: {path}")
        if not resolved.is_file():
            raise IsADirectoryError(f"Path is a directory: {path}")
        return resolved.read_text(encoding="utf-8", errors="replace")

    def write_artifact(
        self,
        filename: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Path:
        """
        Write a research artifact to the sandbox workspace.

        Only writes to the isolated workspace directory.
        """
        safe_filename = re.sub(r"[^\w\-_.]", "_", filename)
        if not safe_filename:
            safe_filename = f"artifact_{len(self.artifacts)}.txt"
        artifact_path = self.workspace_dir / safe_filename
        artifact_path.write_text(content, encoding="utf-8")
        self.artifacts.append(safe_filename)
        logger.debug("Artifact written: %s (%d bytes)", artifact_path, len(content))
        if metadata:
            meta_path = self.workspace_dir / f"{safe_filename}.meta.json"
            import json

            meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        return artifact_path

    def read_artifact(self, filename: str) -> str:
        """Read an artifact from the workspace."""
        safe_filename = re.sub(r"[^\w\-_.]", "_", filename)
        artifact_path = self.workspace_dir / safe_filename
        if not artifact_path.exists():
            raise FileNotFoundError(f"Artifact not found: {filename}")
        return artifact_path.read_text(encoding="utf-8")

    def grep_artifact(
        self,
        pattern: str,
        filename: str,
        ignore_case: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Search for pattern in an artifact.

        Returns list of matches with line numbers and context.
        """
        content = self.read_artifact(filename)
        flags = re.IGNORECASE if ignore_case else 0
        matches = []
        for i, line in enumerate(content.splitlines(), 1):
            if re.search(pattern, line, flags):
                matches.append(
                    {
                        "line_number": i,
                        "line": line.strip(),
                        "match": re.search(pattern, line, flags).group(0),
                    }
                )
        return matches

    def list_artifacts(self) -> List[Dict[str, Any]]:
        """List all artifacts in the workspace."""
        artifacts = []
        for path in self.workspace_dir.iterdir():
            if path.is_file() and not path.name.endswith(".meta.json"):
                stat = path.stat()
                artifacts.append(
                    {
                        "filename": path.name,
                        "size_bytes": stat.st_size,
                        "created_at": datetime.fromtimestamp(
                            stat.st_ctime, tz=timezone.utc
                        ).isoformat(),
                    }
                )
        return artifacts

    def cleanup(self) -> None:
        """Remove workspace directory and all artifacts."""
        if self.workspace_dir.exists():
            shutil.rmtree(self.workspace_dir, ignore_errors=True)
            logger.info("Sandbox cleaned up: session=%s", self.session_id)

    def get_stats(self) -> Dict[str, Any]:
        """Get sandbox statistics."""
        total_size = (
            sum(f.stat().st_size for f in self.workspace_dir.iterdir() if f.is_file())
            if self.workspace_dir.exists()
            else 0
        )
        return {
            "session_id": self.session_id,
            "workspace_dir": str(self.workspace_dir),
            "created_at": self.created_at.isoformat(),
            "artifact_count": len(self.artifacts),
            "total_size_bytes": total_size,
            "allowed_domains_count": len(self._allowed_domains),
        }

    def __enter__(self) -> "VerificationSandbox":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.cleanup()


def cleanup_stale_workspaces(max_age_hours: int = 24) -> int:
    """Remove sandbox workspaces older than max_age_hours."""
    base_dir = Path(settings.verification_workspace_dir)
    if not base_dir.exists():
        return 0

    cutoff = datetime.now(timezone.utc).timestamp() - (max_age_hours * 3600)
    removed = 0

    for workspace in base_dir.iterdir():
        if not workspace.is_dir():
            continue
        try:
            if workspace.stat().st_mtime < cutoff:
                shutil.rmtree(workspace, ignore_errors=True)
                removed += 1
                logger.info("Removed stale workspace: %s", workspace.name)
        except Exception as exc:
            logger.warning("Failed to remove workspace %s: %s", workspace.name, exc)

    return removed
