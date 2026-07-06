from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from .proxy import start_proxy
from .tunnels.ngrok import tunnels
from .tunnels import cloudflare

from omniplayr.plugins import verify_admin, get_plugin_config, api

PLUGIN_KEY = "tunnels@built-in"

proxy = start_proxy(
    proxy_port=get_plugin_config(PLUGIN_KEY, "proxy.proxy_port", 9000),
    frontend_host=get_plugin_config(PLUGIN_KEY, "host.frontend_host", "frontend"),
    frontend_port=get_plugin_config(PLUGIN_KEY, "ports.frontend_port", 8223),
    backend_host=get_plugin_config(PLUGIN_KEY, "host.backend_host", "backend"),
    backend_port=get_plugin_config(PLUGIN_KEY, "ports.backend_port", 8226),
)


class TunnelSetup(BaseModel):
    values: dict[str, str] = Field(default_factory=dict)
    auto_start: bool = False


class AutoStartUpdate(BaseModel):
    enabled: bool


def _find_or_404(name: str):
    tunnel = tunnels.info(name)
    if tunnel is None:
        raise HTTPException(status_code=404, detail="Tunnel not found")
    return tunnel


@api.get("/tunnels")
def get_tunnels(_admin=Depends(verify_admin)):
    return tunnels.list()


@api.put("/tunnels/{name}/setup")
def setup_tunnel(name: str, body: TunnelSetup, _admin=Depends(verify_admin)):
    _find_or_404(name)
    try:
        tunnels.configure(name, body.values, body.auto_start)
        return tunnels.start(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.post("/tunnels/{name}/auth")
def begin_tunnel_auth(name: str, _admin=Depends(verify_admin)):
    tunnel = _find_or_404(name)
    if not tunnel.get("auth"):
        raise HTTPException(status_code=400, detail="This tunnel does not use browser authentication")
    try:
        return tunnels.begin_auth(name)
    except (RuntimeError, TimeoutError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.get("/tunnels/{name}/auth")
def get_tunnel_auth(name: str, _admin=Depends(verify_admin)):
    tunnel = _find_or_404(name)
    if not tunnel.get("auth"):
        raise HTTPException(status_code=400, detail="This tunnel does not use browser authentication")
    return tunnels.auth_status(name)


@api.put("/tunnels/{name}/auto-start")
def update_auto_start(name: str, body: AutoStartUpdate, _admin=Depends(verify_admin)):
    _find_or_404(name)
    return tunnels.set_auto_start(name, body.enabled)


@api.post("/tunnels/{name}/start")
def start_tunnel(name: str, _admin=Depends(verify_admin)):
    _find_or_404(name)
    try:
        return tunnels.start(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.post("/tunnels/{name}/stop")
def stop_tunnel(name: str, _admin=Depends(verify_admin)):
    _find_or_404(name)
    return tunnels.stop(name)


def setup():
    tunnels.start_automatic()
