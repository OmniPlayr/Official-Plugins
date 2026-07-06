from __future__ import annotations

import base64
import hashlib
import json
import os
import platform
import re
import stat
import subprocess
import threading
import urllib.request
from pathlib import Path

from ..tunnel_registry import TunnelRegistry

from omniplayr.plugins import log, get_plugin_config

PLUGIN_KEY = "tunnels@built-in"
PLUGIN_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = PLUGIN_DIR / ".cloudflared"
CERT_PATH = DATA_DIR / "cert.pem"
ZONE_PATH = DATA_DIR / "zone.json"
SETTINGS_PATH = PLUGIN_DIR / "cloudflare-settings.json"

from .ngrok import tunnels

_auth_lock = threading.Lock()
_auth_process: subprocess.Popen | None = None
_auth_url: str | None = None
_auth_error: str | None = None
_auth_ready = threading.Event()


def _binary_name() -> str:
    return "cloudflared"


def _download_url() -> str:
    if platform.system() != "Linux":
        raise RuntimeError("Cloudflare Tunnel is only supported inside the Linux backend container")
    machine = platform.machine().lower()
    architectures = {
        "x86_64": "amd64",
        "amd64": "amd64",
        "aarch64": "arm64",
        "arm64": "arm64",
        "armv7l": "arm",
        "armv6l": "arm",
        "i386": "386",
        "i686": "386",
    }
    arch = architectures.get(machine)
    if not arch:
        raise RuntimeError(f"Unsupported Linux architecture: {machine}")
    return f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{arch}"


def _cloudflared() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    binary = DATA_DIR / _binary_name()
    if binary.exists():
        return binary
    log("Downloading cloudflared for the tunnels plugin", "info", "tunnels")
    request = urllib.request.Request(_download_url(), headers={"User-Agent": "OmniPlayr-Tunnels/1.0"})
    temporary = binary.with_suffix(binary.suffix + ".download")
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        temporary.chmod(temporary.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        temporary.replace(binary)
    finally:
        temporary.unlink(missing_ok=True)
    return binary


def _environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment["HOME"] = str(PLUGIN_DIR)
    return environment


def _run(*arguments: str, timeout: int = 60) -> subprocess.CompletedProcess:
    result = subprocess.run(
        [str(_cloudflared()), "tunnel", "--origincert", str(CERT_PATH), *arguments],
        text=True,
        capture_output=True,
        timeout=timeout,
        env=_environment(),
    )
    if result.returncode:
        message = (result.stderr or result.stdout).strip()
        raise RuntimeError(message or f"cloudflared exited with code {result.returncode}")
    return result


def _authenticated() -> bool:
    return CERT_PATH.is_file() and CERT_PATH.stat().st_size > 0


def _certificate_data() -> dict:
    content = CERT_PATH.read_text(encoding="utf-8")
    match = re.search(
        r"-----BEGIN ARGO TUNNEL TOKEN-----\s*(.*?)\s*-----END ARGO TUNNEL TOKEN-----",
        content,
        re.S,
    )
    if not match:
        raise RuntimeError("Cloudflare login certificate could not be read")
    encoded = re.sub(r"\s+", "", match.group(1))
    return json.loads(base64.b64decode(encoded).decode("utf-8"))


def _domain() -> str | None:
    if not _authenticated():
        return None
    if ZONE_PATH.exists():
        try:
            return json.loads(ZONE_PATH.read_text(encoding="utf-8")).get("domain")
        except (OSError, json.JSONDecodeError):
            pass
    certificate = _certificate_data()
    zone_id = certificate.get("zoneID")
    api_token = certificate.get("apiToken")
    if not zone_id or not api_token:
        raise RuntimeError("Cloudflare login certificate does not contain a selected domain")
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/zones/{zone_id}",
        headers={
            "Authorization": f"Bearer {api_token}",
            "Accept": "application/json",
            "User-Agent": "OmniPlayr-Tunnels/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.load(response)
    domain = str(payload.get("result", {}).get("name", "")).strip().lower()
    if not payload.get("success") or not domain:
        raise RuntimeError("Cloudflare did not return the selected domain")
    ZONE_PATH.write_text(json.dumps({"domain": domain}, indent=2) + "\n", encoding="utf-8")
    return domain


def _read_auth_output(process: subprocess.Popen) -> None:
    global _auth_url, _auth_error
    lines: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        lines.append(line.rstrip())
        match = re.search(r"https://[^\s]+", line)
        if match and ("cloudflare.com" in match.group(0) or "cloudflareaccess.com" in match.group(0)):
            _auth_url = match.group(0).rstrip(".,)")
            _auth_ready.set()
    process.wait()
    if process.returncode and not _authenticated():
        _auth_error = "\n".join(lines[-4:]) or "Cloudflare login failed"
    _auth_ready.set()


def begin_auth() -> dict:
    global _auth_process, _auth_url, _auth_error
    if _authenticated():
        return auth_status()
    with _auth_lock:
        if _auth_process is None or _auth_process.poll() is not None:
            _auth_url = None
            _auth_error = None
            _auth_ready.clear()
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            _auth_process = subprocess.Popen(
                [str(_cloudflared()), "tunnel", "--origincert", str(CERT_PATH), "login"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=_environment(),
            )
            threading.Thread(target=_read_auth_output, args=(_auth_process,), daemon=True).start()
    if not _auth_ready.wait(20):
        raise TimeoutError("Cloudflare did not provide a login URL in time")
    if _auth_error:
        raise RuntimeError(_auth_error)
    return auth_status()


def auth_status() -> dict:
    domain = None
    error = _auth_error
    if _authenticated():
        try:
            domain = _domain()
        except Exception as exc:
            error = str(exc)
    return {"authenticated": bool(domain), "url": _auth_url, "error": error, "domain": domain}


def _setup_authenticated() -> bool:
    try:
        return bool(_domain())
    except Exception:
        return False


def _configured() -> bool:
    if not (_authenticated() and SETTINGS_PATH.exists()):
        return False
    try:
        settings = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        return all(settings.get(key) for key in ("name", "hostname", "domain", "id", "credentials_file"))
    except (OSError, json.JSONDecodeError):
        return False


def _save_setup(values: dict) -> None:
    if not _authenticated():
        raise ValueError("Log in to Cloudflare before creating a tunnel")
    domain = _domain()
    subdomain = str(values.get("SUBDOMAIN", "")).strip().lower().rstrip(".")
    if not domain or not subdomain:
        raise ValueError("A subdomain is required")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", subdomain):
        raise ValueError("Use only letters, numbers, and hyphens for the subdomain")
    hostname = f"{subdomain}.{domain}"
    name = f"omniplayr-{subdomain}-{hashlib.sha256(hostname.encode()).hexdigest()[:8]}"

    existing = None
    if SETTINGS_PATH.exists():
        try:
            current = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            if current.get("name") == name:
                existing = current
        except (OSError, json.JSONDecodeError):
            pass

    if existing:
        tunnel_id = existing["id"]
        credentials = Path(existing["credentials_file"])
    else:
        created = _run("create", name)
        match = re.search(r"Created tunnel .*? with id ([0-9a-f-]{36})", created.stdout + created.stderr, re.I)
        if not match:
            raise RuntimeError("Cloudflare created the tunnel but its ID could not be read")
        tunnel_id = match.group(1)
        credentials = DATA_DIR / f"{tunnel_id}.json"

    _run("route", "dns", "--overwrite-dns", tunnel_id, hostname)
    settings = {
        "name": name,
        "hostname": hostname,
        "domain": domain,
        "subdomain": subdomain,
        "id": tunnel_id,
        "credentials_file": str(credentials),
    }
    SETTINGS_PATH.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")


def start_cloudflare(proxy_port: int = 9000) -> dict:
    settings = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    command = [
        str(_cloudflared()), "tunnel", "--origincert", str(CERT_PATH),
        "--url", f"http://127.0.0.1:{proxy_port}", "run", settings["id"],
    ]
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=_environment(),
    )
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    if process.poll() is not None:
        output = process.stdout.read().strip() if process.stdout else ""
        raise RuntimeError(output or "cloudflared stopped before the tunnel was ready")
    url = f"https://{settings['hostname']}"
    log(f"Started Cloudflare Tunnel on {url}", "info", "tunnels")
    return {"process": process, "url": url}


def stop_cloudflare(instance=None) -> bool:
    if not instance:
        return False
    process = instance["process"]
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
    log("Stopped Cloudflare Tunnel", "info", "tunnels")
    return True


tunnels.register(
    "cloudflare",
    start_cloudflare,
    stop_cloudflare,
    proxy_port=get_plugin_config(PLUGIN_KEY, "proxy.proxy_port", 9000),
    setup={
        "display_name": "Cloudflare Tunnel",
        "description": "Publish OmniPlayr on your own Cloudflare-managed domain without an API token.",
        "instructions": "Authorize OmniPlayr with Cloudflare, then choose the subdomain for your public address.",
        "fields": [
            {"key": "SUBDOMAIN", "label": "Subdomain", "required": True},
        ],
        "is_configured": _configured,
        "save": _save_setup,
        "auth": {
            "authenticated": _setup_authenticated,
            "begin": begin_auth,
            "status": auth_status,
            "domain": _domain,
        },
        "icon": "cloudflared.png",
    },
)
