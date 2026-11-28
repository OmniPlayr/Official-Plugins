import asyncio
import builtins
import datetime
import json
import threading
from typing import NotRequired, TypedDict, Optional
from . import PLUGIN_KEY
from omniplayr.plugins import get_plugin_config, get_token_user, log, api, verify_auth
from fastapi import Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
_db = None
_emit_lock = threading.RLock()
_maintenance_lock = threading.RLock()
_maintenance_by_account: dict[int, float] = {}
_MAINTENANCE_INTERVAL_SECONDS = 5
_account_token_lock = threading.RLock()
_account_token_cache: dict[str, tuple[int | None, float]] = {}
_ACCOUNT_TOKEN_CACHE_SECONDS = 10
VALID_DEVICE_STATUSES = {"online", "idle", "unconnectable"}
_devices_subscribers_lock = threading.RLock()
_devices_subscribers: dict[int, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
_command_subscribers_lock = threading.RLock()
_command_subscribers: dict[tuple[int, int], set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
websocket_route = getattr(api, "websocket", None) or api._router.websocket

def _account_token(request: Request) -> str:
    return request.headers.get("X-Account-Token", "") or ""

def _account_id_from_token(token: str) -> int | None:
    if not token:
        return None

    now = datetime.datetime.now(datetime.timezone.utc).timestamp()
    with _account_token_lock:
        cached = _account_token_cache.get(token)
        if cached and cached[1] > now:
            return cached[0]

    account_id = get_token_user(token)

    with _account_token_lock:
        _account_token_cache[token] = (account_id, now + _ACCOUNT_TOKEN_CACHE_SECONDS)

    return account_id

def _account_id(request: Request) -> int | None:
    return _account_id_from_token(_account_token(request))

def _websocket_account_id(websocket: WebSocket) -> int | None:
    return _account_id_from_token(websocket.query_params.get("account_token", "") or "")

def _subscribe(subscribers, lock, key):
    loop = asyncio.get_running_loop()
    queue = asyncio.Queue(maxsize=1)

    with lock:
        subscribers.setdefault(key, set()).add((loop, queue))

    return loop, queue

def _unsubscribe(subscribers, lock, key, subscription):
    with lock:
        queues = subscribers.get(key)
        if not queues:
            return

        queues.discard(subscription)
        if not queues:
            subscribers.pop(key, None)

def _notify(subscribers, lock, key):
    with lock:
        queues = builtins.list(subscribers.get(key, set()))

    for loop, queue in queues:
        def wake(q=queue):
            if q.full():
                return
            q.put_nowait(True)

        loop.call_soon_threadsafe(wake)

def notify_devices_changed(account_id: int):
    _notify(_devices_subscribers, _devices_subscribers_lock, account_id)

def notify_commands_changed(account_id: int, device_id: int):
    _notify(_command_subscribers, _command_subscribers_lock, (account_id, device_id))

def init(db):
    global _db
    _db = db

class Device(TypedDict):
    id: NotRequired[int | None]
    account_id: NotRequired[int]
    identifier: str
    type: str
    ip: NotRequired[Optional[str]]
    label: NotRequired[Optional[str]]
    status: NotRequired[Optional[str]]

class Command(TypedDict):
    type: str
    payload: NotRequired[dict]

def is_user_agent_identifier(identifier: str) -> bool:
    return any(token in identifier for token in (
        "Mozilla/",
        "AppleWebKit/",
        "Chrome/",
        "Firefox/",
        "Safari/",
        "Edg/",
        "OPR/",
    ))

def has_reliable_identifier(device: Device) -> bool:
    identifier = (device.get("identifier") or "").strip()
    if not identifier:
        return False

    return not is_user_agent_identifier(identifier)

def find_reliable_device(account_id: int, body: Device):
    if not _db or not has_reliable_identifier(body):
        return None

    return _db.fetch_one("devices", where={
        "account_id": account_id,
        "identifier": body["identifier"],
        "type": body["type"]
    })

def remove_reliable_duplicates(account_id: int, keep_id: int, body: Device):
    if not _db or not has_reliable_identifier(body):
        return 0

    devices = _db.fetch("devices", where={
        "account_id": account_id,
        "identifier": body["identifier"],
        "type": body["type"]
    })
    removed = 0

    for device in devices:
        if device["id"] == keep_id:
            continue

        removed += _db.delete("devices", {
            "id": device["id"],
            "account_id": account_id
        })

    return removed

def _timestamp_value(value):
    if not value:
        return 0.0

    if isinstance(value, str):
        value = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))

    return value.timestamp()

def dedupe_reliable_devices(account_id: int):
    if not _db:
        return 0

    devices = _db.fetch("devices", where={"account_id": account_id})
    reliable_devices = {}
    removed = 0

    for device in devices:
        if not has_reliable_identifier(device):
            continue

        key = (device["identifier"], device["type"])
        existing = reliable_devices.get(key)
        if not existing:
            reliable_devices[key] = device
            continue

        existing_time = _timestamp_value(existing.get("updated_at") or existing.get("expires_at"))
        device_time = _timestamp_value(device.get("updated_at") or device.get("expires_at"))

        if (device_time, device["id"]) > (existing_time, existing["id"]):
            removed += _db.delete("devices", {
                "id": existing["id"],
                "account_id": account_id
            })
            reliable_devices[key] = device
        else:
            removed += _db.delete("devices", {
                "id": device["id"],
                "account_id": account_id
            })

    return removed

def remove_expired_devices(account_id: int | None = None):
    if not _db:
        return 0

    where = {"account_id": account_id} if account_id is not None else None
    devices = _db.fetch("devices", where=where)
    now = datetime.datetime.now(datetime.timezone.utc)
    removed = 0

    for device in devices:
        expires_at = device.get("expires_at")

        if not expires_at:
            continue

        if isinstance(expires_at, str):
            expires_at = datetime.datetime.fromisoformat(expires_at.replace("Z", "+00:00"))

        if expires_at <= now:
            removed += _db.delete("devices", {
                "id": device["id"]
            })

    return removed

def maybe_maintain_devices(account_id: int):
    now = datetime.datetime.now(datetime.timezone.utc).timestamp()
    with _maintenance_lock:
        last_run = _maintenance_by_account.get(account_id, 0.0)
        if now - last_run < _MAINTENANCE_INTERVAL_SECONDS:
            return
        _maintenance_by_account[account_id] = now

    remove_expired_devices(account_id)
    dedupe_reliable_devices(account_id)

def list_devices_for_account(account_id: int):
    maybe_maintain_devices(account_id)

    if _db:
        return _db.fetch("devices", where={"account_id": account_id})

    return []

@api.get("/devices/list")
def list(request: Request, auth=Depends(verify_auth)):
    log("GET /devices/list: requested", "debug")
    if not auth:
        log("GET /devices/list: auth check failed", "debug")
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_id = _account_id(request)
    if not account_id:
        raise HTTPException(status_code=401, detail="Invalid account token")

    log(f"GET /devices/list: account_id={account_id}", "debug")
    return {"devices": list_devices_for_account(account_id)}

@websocket_route("/devices/list/ws")
async def devices_list_ws(websocket: WebSocket):
    account_id = _websocket_account_id(websocket)
    if not account_id:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    subscription = _subscribe(_devices_subscribers, _devices_subscribers_lock, account_id)

    try:
        while True:
            await websocket.send_json(jsonable_encoder({
                "type": "devices",
                "devices": list_devices_for_account(account_id),
            }))
            await subscription[1].get()
    except WebSocketDisconnect:
        pass
    finally:
        _unsubscribe(_devices_subscribers, _devices_subscribers_lock, account_id, subscription)

def get_device(account_id: int, device_id: int):
    if _db:
        return _db.fetch_one("devices", where={"id": device_id, "account_id": account_id})
    else:
        return None

def normalize_status(status: Optional[str]) -> Optional[str]:
    if status is None:
        return None

    if status not in VALID_DEVICE_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid device status")

    return status

def emit_device_for_account(account_id: int, body: Device):
    remove_expired_devices(account_id)

    if not _db:
        log("POST /device/emit: Database not initialized", "debug")
        raise HTTPException(status_code=500, detail="Database not initialized")

    expiry = int(get_plugin_config(PLUGIN_KEY, "devices.heartbeat_interval", default=20))
    status = normalize_status(body.get("status"))

    def create_device():
        with _emit_lock:
            existing = find_reliable_device(account_id, body)
            if existing:
                expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=expiry)
                updated = _db.update("devices", {
                    "account_id": account_id,
                    "identifier": body["identifier"],
                    "type": body["type"],
                    "ip": body.get("ip"),
                    "label": body.get("label"),
                    "status": status,
                    "expires_at": expires_at,
                    "updated_at": datetime.datetime.now(datetime.timezone.utc)
                }, {
                    "id": existing["id"],
                    "account_id": account_id
                })

                if updated:
                    remove_reliable_duplicates(account_id, existing["id"], body)
                    notify_devices_changed(account_id)
                    return {
                        "id": existing["id"],
                        "expires_at": expires_at,
                        "created": False,
                    }

            log(f"POST /device/emit: Creating device for account {account_id}", "debug")
            row = _db.insert("devices", {
                "account_id": account_id,
                "identifier": body["identifier"],
                "type": body["type"],
                "ip": body.get("ip"),
                "label": body.get("label"),
                "status": status,
                "expires_at": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=expiry)
            })

            if not row:
                log(f"POST /device/emit: Failed to create device for account {account_id}", "debug")
                raise HTTPException(status_code=500, detail="Failed to create device")

            log(f"POST /device/emit: Created device for account {account_id}", "debug")

            notify_devices_changed(account_id)
            return {
                "id": row["id"],
                "expires_at": row["expires_at"],
                "created": True,
            }

    reliable_device = find_reliable_device(account_id, body)
    row_id = body.get("id")
    existing_row = None

    if reliable_device and reliable_device["id"] != row_id:
        row_id = reliable_device["id"]
        existing_row = reliable_device
    elif reliable_device and reliable_device["id"] == row_id:
        existing_row = reliable_device

    if row_id is not None:
        device_row = existing_row or get_device(account_id, row_id)
        if not device_row:
            log(f"POST /device/emit: Device {row_id} not found", "debug")
            create_response = create_device()
            status_label = "created" if create_response.get("created", True) else "updated"
            return {
                "status": status_label,
                "message": "Device created successfully" if status_label == "created" else "Device updated successfully",
                "id": create_response["id"],
                "expires_at": create_response["expires_at"]
            }

        log(f"POST /device/emit: Updating device {row_id}", "debug")
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=expiry)

        updated = _db.update("devices", {
            "account_id": account_id,
            "identifier": body["identifier"],
            "type": body["type"],
            "ip": body.get("ip"),
            "label": body.get("label"),
            "status": status,
            "expires_at": expires_at,
            "updated_at": datetime.datetime.now(datetime.timezone.utc)
        }, {
            "id": row_id,
            "account_id": account_id
        })

        if not updated:
            log(f"POST /device/emit: Failed to update device {row_id}", "debug")
            raise HTTPException(status_code=404, detail="Device not found")

        remove_reliable_duplicates(account_id, row_id, body)

        log(f"POST /device/emit: Updated device {row_id}", "debug")
        notify_devices_changed(account_id)
        return {
            "status": "updated",
            "message": "Device updated successfully",
            "id": row_id,
            "expires_at": expires_at
        }
    else:
        log(f"POST /device/emit: Creating device for account {account_id}", "debug")
        create_response = create_device()
        remove_reliable_duplicates(account_id, create_response["id"], body)
        status_label = "created" if create_response.get("created", True) else "updated"
        return {
            "status": status_label,
            "message": "Device created successfully" if status_label == "created" else "Device updated successfully",
            "id": create_response["id"],
            "expires_at": create_response["expires_at"]
        }

@api.post("/devices/emit")
@api.post("/device/emit")
def emit(request: Request, body: Device, auth=Depends(verify_auth)):
    log("POST /device/emit: requested", "debug")
    if not auth:
        log("POST /device/emit: auth check failed", "debug")
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_id = _account_id(request)
    if not account_id:
        log("POST /device/emit: account token resolved to no account", "debug")
        raise HTTPException(status_code=401, detail="Invalid account token")

    return emit_device_for_account(account_id, body)

@websocket_route("/devices/emit/ws")
@websocket_route("/device/emit/ws")
async def emit_ws(websocket: WebSocket):
    account_id = _websocket_account_id(websocket)
    if not account_id:
        await websocket.close(code=1008)
        return

    await websocket.accept()

    try:
        while True:
            body = await websocket.receive_json()
            await websocket.send_json(jsonable_encoder(emit_device_for_account(account_id, body)))
    except WebSocketDisconnect:
        pass

@api.delete("/devices/disconnect")
@api.post("/devices/disconnect")
@api.delete("/device/disconnect")
@api.post("/device/disconnect")
def disconnect(request: Request, body: Device, auth=Depends(verify_auth)):
    log("DELETE /device/disconnect: requested", "debug")
    if not auth:
        log("DELETE /device/disconnect: auth check failed", "debug")
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_id = _account_id(request)
    if not account_id:
        log("DELETE /device/disconnect: account token resolved to no account", "debug")
        raise HTTPException(status_code=401, detail="Invalid account token")

    if not _db:
        log("DELETE /device/disconnect: Database not initialized", "debug")
        raise HTTPException(status_code=500, detail="Database not initialized")

    row_id = body.get("id")
    removed = 0

    if row_id is not None:
        removed += _db.delete("devices", {
            "id": row_id,
            "account_id": account_id
        })
    elif has_reliable_identifier(body):
        removed += _db.delete("devices", {
            "account_id": account_id,
            "identifier": body["identifier"],
            "type": body["type"]
        })

    log(f"DELETE /device/disconnect: removed={removed} account_id={account_id}", "debug")
    if removed:
        notify_devices_changed(account_id)
    return {"ok": True, "removed": removed}

@api.post("/device/{device_id}/command")
@api.post("/devices/{device_id}/command")
def device_command_send(request: Request, device_id: int, body: Command, auth=Depends(verify_auth)):
    log(f"POST /device/{device_id}/command: requested", "debug")
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_id = _account_id(request)
    if not account_id:
        raise HTTPException(status_code=401, detail="Invalid account token")

    if not _db:
        raise HTTPException(status_code=500, detail="Database not initialized")

    if not get_device(account_id, device_id):
        raise HTTPException(status_code=404, detail="Device not found")

    command_type = body.get("type")
    if not command_type:
        raise HTTPException(status_code=422, detail="Command type is required")

    row = _db.insert("device_commands", {
        "account_id": account_id,
        "target_device_id": device_id,
        "type": command_type,
        "payload": json.dumps(body.get("payload") or {}),
    })

    if not row:
        raise HTTPException(status_code=500, detail="Failed to queue device command")

    notify_commands_changed(account_id, device_id)
    return {"ok": True, "id": row["id"]}

def get_pending_commands(account_id: int, device_id: int):
    if not _db:
        raise HTTPException(status_code=500, detail="Database not initialized")

    if not get_device(account_id, device_id):
        return {"commands": [], "device_missing": True}

    rows = _db.fetch("device_commands", where={
        "account_id": account_id,
        "target_device_id": device_id
    })
    commands = []

    for row in sorted(rows, key=lambda command: command["id"]):
        payload = {}
        if row.get("payload"):
            try:
                payload = json.loads(row["payload"])
            except json.JSONDecodeError:
                payload = {}

        commands.append({
            "id": row["id"],
            "type": row["type"],
            "payload": payload,
        })
        _db.delete("device_commands", {
            "id": row["id"],
            "account_id": account_id,
            "target_device_id": device_id
        })

    return {"commands": commands}

@api.get("/device/{device_id}/commands")
@api.get("/devices/{device_id}/commands")
def device_commands_get(request: Request, device_id: int, auth=Depends(verify_auth)):
    log(f"GET /device/{device_id}/commands: requested", "debug")
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_id = _account_id(request)
    if not account_id:
        raise HTTPException(status_code=401, detail="Invalid account token")

    return get_pending_commands(account_id, device_id)

@websocket_route("/device/{device_id}/commands/ws")
@websocket_route("/devices/{device_id}/commands/ws")
async def device_commands_ws(websocket: WebSocket, device_id: int):
    account_id = _websocket_account_id(websocket)
    if not account_id:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    subscription = _subscribe(
        _command_subscribers,
        _command_subscribers_lock,
        (account_id, device_id),
    )

    try:
        while True:
            response = get_pending_commands(account_id, device_id)
            if response.get("device_missing") or response.get("commands"):
                await websocket.send_json(jsonable_encoder(response))
            await subscription[1].get()
    except WebSocketDisconnect:
        pass
    finally:
        _unsubscribe(
            _command_subscribers,
            _command_subscribers_lock,
            (account_id, device_id),
            subscription,
        )

@api.get("/device/{device_id}")
def device_get(request: Request, device_id: int, auth=Depends(verify_auth)):
    log(f"GET /device/{device_id}: requested", "debug")
    if not auth:
        log(f"GET /device/{device_id}: auth check failed", "debug")
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_id = _account_id(request)
    if not account_id:
        log(f"GET /device/{device_id}: account token resolved to no account", "debug")
        raise HTTPException(status_code=401, detail="Invalid account token")
    remove_expired_devices(account_id)
    if not _db:
        log(f"GET /device/{device_id}: Database not initialized", "debug")
        raise HTTPException(status_code=500, detail="Database not initialized")
    device = get_device(account_id, device_id)
    if not device:
        log(f"GET /device/{device_id}: Device not found", "debug")
        raise HTTPException(status_code=404, detail="Device not found")
    return device
