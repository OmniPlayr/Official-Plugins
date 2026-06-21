import asyncio
import os
import threading
from pathlib import Path

import ngrok
from dotenv import dotenv_values, load_dotenv

from api.helpers.log import log
from api.helpers.plugin_config import get_plugin_config
from ..tunnel_registry import TunnelRegistry

PLUGIN_KEY = "tunnels@built-in"
PLUGIN_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = PLUGIN_DIR / ".env"
SETTINGS_PATH = PLUGIN_DIR / "tunnel-settings.json"

load_dotenv(ENV_PATH, override=True)
tunnels = TunnelRegistry(SETTINGS_PATH)


def _configured():
    return bool((dotenv_values(ENV_PATH).get("NGROK_AUTH_TOKEN") or "").strip())


def _save_setup(values):
    token = str(values.get("NGROK_AUTH_TOKEN", "")).strip()
    if not token:
        return
    lines = []
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if not line.startswith("NGROK_AUTH_TOKEN="):
                lines.append(line)
    lines.insert(0, f"NGROK_AUTH_TOKEN={token}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ["NGROK_AUTH_TOKEN"] = token


def start_ngrok(proxy_port=9000):
    result = {}
    ready = threading.Event()
    stop_requested = threading.Event()

    def run():
        async def main():
            token = (dotenv_values(ENV_PATH).get("NGROK_AUTH_TOKEN") or "").strip()
            listener = await ngrok.forward(proxy_port, authtoken=token)
            result.update(listener=listener, url=listener.url())
            ready.set()
            while not stop_requested.is_set():
                await asyncio.sleep(0.2)
            close_result = listener.close()
            if asyncio.iscoroutine(close_result):
                await close_result

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(main())
        except Exception as exc:
            result["error"] = exc
            ready.set()
            log(f"Failed to start ngrok: {exc}", "error", "tunnels")
        finally:
            loop.close()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    if not ready.wait(timeout=30):
        stop_requested.set()
        raise TimeoutError("Timed out while starting ngrok")
    if "error" in result:
        raise RuntimeError(f"Failed to start ngrok: {result['error']}") from result["error"]
    result.update(stop_event=stop_requested, thread=thread)
    log(f"Started ngrok on {result['url']}", "info", "tunnels")
    return result


def stop_ngrok(instance=None):
    if not instance:
        return False
    instance["stop_event"].set()
    instance["thread"].join(timeout=10)
    log("Stopped ngrok", "info", "tunnels")
    return True


tunnels.register(
    "ngrok",
    start_ngrok,
    stop_ngrok,
    proxy_port=get_plugin_config(PLUGIN_KEY, "proxy.proxy_port", 9000),
    setup={
        "display_name": "ngrok",
        "description": "A secure public URL for your OmniPlayr server, powered by ngrok.",
        "setup_url": "https://dashboard.ngrok.com/get-started/your-authtoken",
        "instructions": "Open the ngrok dashboard, copy your auth token, and paste it below.",
        "fields": [{"key": "NGROK_AUTH_TOKEN", "label": "Auth token", "secret": True, "required": True}],
        "is_configured": _configured,
        "save": _save_setup,
        "icon": "ngrok.png",
    },
)
