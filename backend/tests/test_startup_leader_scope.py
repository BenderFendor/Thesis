"""Startup leadership is scoped to one repository and backend instance."""

from app.main import _startup_leader_lock_path


def test_backend_ports_get_distinct_startup_leader_locks(monkeypatch):
    monkeypatch.delenv("SCOOP_RUNTIME_INSTANCE", raising=False)
    monkeypatch.delenv("GUNICORN_BIND", raising=False)
    monkeypatch.setenv("BACKEND_PORT", "8000")
    first = _startup_leader_lock_path()
    monkeypatch.setenv("BACKEND_PORT", "8123")
    second = _startup_leader_lock_path()

    assert first != second
    assert first.parent.parent == second.parent.parent


def test_gunicorn_workers_for_same_bind_share_lock(monkeypatch):
    monkeypatch.delenv("SCOOP_RUNTIME_INSTANCE", raising=False)
    monkeypatch.setenv("GUNICORN_BIND", "127.0.0.1:8000")

    assert _startup_leader_lock_path() == _startup_leader_lock_path()
