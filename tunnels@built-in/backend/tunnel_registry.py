from __future__ import annotations

import json
import threading
from pathlib import Path

from omniplayr.plugins import log

class TunnelRegistry:
    def __init__(self, settings_path: Path):
        self.tunnels: dict[str, dict] = {}
        self.settings_path = settings_path
        self._lock = threading.RLock()

    def _settings(self) -> dict:
        if not self.settings_path.exists():
            return {}
        try:
            return json.loads(self.settings_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_settings(self, settings: dict) -> None:
        self.settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")

    def register(self, name, start_func, stop_func=None, *, setup=None, **options):
        setup = setup or {}
        settings = self._settings().get(name, {})
        self.tunnels[name] = {
            "name": name,
            "display_name": setup.get("display_name", name.title()),
            "description": setup.get("description", ""),
            "icon": setup.get("icon"),
            "setup_url": setup.get("setup_url"),
            "setup_instructions": setup.get("instructions", ""),
            "fields": setup.get("fields", []),
            "is_configured": setup.get("is_configured", lambda: True),
            "save_setup": setup.get("save", lambda _values: None),
            "auth": setup.get("auth"),
            "start_func": start_func,
            "stop_func": stop_func,
            "options": options,
            "instance": None,
            "running": False,
            "starting": False,
            "url": None,
            "error": None,
            "auto_start": bool(settings.get("auto_start", False)),
        }

    def begin_auth(self, name: str):
        tunnel = self.tunnels.get(name)
        if tunnel is None or not tunnel["auth"]:
            return None
        return tunnel["auth"]["begin"]()

    def auth_status(self, name: str):
        tunnel = self.tunnels.get(name)
        if tunnel is None or not tunnel["auth"]:
            return None
        return tunnel["auth"]["status"]()

    def configure(self, name: str, values: dict, auto_start: bool | None = None):
        tunnel = self.tunnels.get(name)
        if tunnel is None:
            return None
        if not tunnel["is_configured"]():
            missing = [
                field["label"]
                for field in tunnel["fields"]
                if field.get("required") and not str(values.get(field["key"], "")).strip()
            ]
            if missing:
                raise ValueError(f"Missing required setup field: {', '.join(missing)}")
        tunnel["save_setup"](values)
        if auto_start is not None:
            self.set_auto_start(name, auto_start)
        return self.info(name)

    def set_auto_start(self, name: str, enabled: bool):
        tunnel = self.tunnels.get(name)
        if tunnel is None:
            return None
        tunnel["auto_start"] = bool(enabled)
        settings = self._settings()
        settings.setdefault(name, {})["auto_start"] = bool(enabled)
        self._save_settings(settings)
        return self.info(name)

    def start(self, name):
        tunnel = self.tunnels.get(name)
        if tunnel is None:
            return None
        with self._lock:
            if tunnel["running"] or tunnel["starting"]:
                return self.info(name)
            if not tunnel["is_configured"]():
                raise ValueError(f"{tunnel['display_name']} has not been set up")
            tunnel["starting"] = True
            tunnel["error"] = None
            try:
                instance = tunnel["start_func"](**tunnel["options"])
                tunnel["instance"] = instance
                tunnel["url"] = getattr(instance, "url", None)
                if callable(tunnel["url"]):
                    tunnel["url"] = tunnel["url"]()
                if isinstance(instance, dict):
                    tunnel["url"] = instance.get("url")
                tunnel["running"] = True
            except Exception as exc:
                tunnel["error"] = str(exc)
                raise
            finally:
                tunnel["starting"] = False
        return self.info(name)

    def stop(self, name):
        tunnel = self.tunnels.get(name)
        if tunnel is None:
            return None
        with self._lock:
            if tunnel["stop_func"] and tunnel["instance"]:
                tunnel["stop_func"](tunnel["instance"])
            tunnel["instance"] = None
            tunnel["running"] = False
            tunnel["starting"] = False
        return self.info(name)

    def start_automatic(self):
        for name, tunnel in self.tunnels.items():
            if not tunnel["auto_start"]:
                continue
            try:
                self.start(name)
            except Exception as exc:
                log(f"Could not auto-start tunnel {name}: {exc}", "error", "tunnels")

    def info(self, name):
        tunnel = self.tunnels.get(name)
        if tunnel is None:
            return None
        auth = tunnel["auth"]
        auth_domain = None
        if auth:
            try:
                auth_domain = auth.get("domain", lambda: None)()
            except Exception:
                pass
        return {
            "name": tunnel["name"],
            "display_name": tunnel["display_name"],
            "description": tunnel["description"],
            "icon": tunnel["icon"],
            "setup_url": tunnel["setup_url"],
            "setup_instructions": tunnel["setup_instructions"],
            "fields": tunnel["fields"],
            "configured": bool(tunnel["is_configured"]()),
            "running": tunnel["running"],
            "starting": tunnel["starting"],
            "url": tunnel["url"],
            "error": tunnel["error"],
            "auto_start": tunnel["auto_start"],
            "auth": ({
                "required": True,
                "authenticated": bool(auth["authenticated"]()),
                "domain": auth_domain,
            } if auth else None),
        }

    def list(self):
        return [self.info(name) for name in self.tunnels]
