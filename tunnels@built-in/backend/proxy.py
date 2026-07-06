import asyncio
import threading
from urllib.parse import urlsplit
from aiohttp import ClientSession, ClientTimeout, TCPConnector, WSMsgType, web

from omniplayr.plugins import log

_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

def _should_use_backend(path, backend_prefixes):
    clean_path = urlsplit(path).path
    return any(
        clean_path == prefix or clean_path.startswith(prefix + "/")
        for prefix in backend_prefixes
    )


def _connection_tokens(headers):
    tokens = set()
    for value in headers.getall("Connection", []):
        tokens.update(token.strip().lower() for token in value.split(","))
    return tokens


def _forward_headers(headers, *, websocket=False):
    blocked = _HOP_BY_HOP_HEADERS | _connection_tokens(headers)
    if websocket:
        blocked.update(
            {
                "sec-websocket-accept",
                "sec-websocket-extensions",
                "sec-websocket-key",
                "sec-websocket-protocol",
                "sec-websocket-version",
            }
        )
    return [(name, value) for name, value in headers.items() if name.lower() not in blocked]


def _websocket_protocols(request):
    values = request.headers.getall("Sec-WebSocket-Protocol", [])
    return [protocol.strip() for value in values for protocol in value.split(",") if protocol.strip()]


async def _relay_websocket(source, destination):
    async for message in source:
        if message.type == WSMsgType.TEXT:
            await destination.send_str(message.data)
        elif message.type == WSMsgType.BINARY:
            await destination.send_bytes(message.data)
        elif message.type == WSMsgType.PING:
            await destination.ping(message.data)
        elif message.type == WSMsgType.PONG:
            await destination.pong(message.data)
        elif message.type == WSMsgType.CLOSE:
            await destination.close(code=message.data, message=message.extra.encode())
            break
        elif message.type in (WSMsgType.CLOSED, WSMsgType.ERROR):
            break


class TunnelProxy:
    def __init__(
        self,
        proxy_port,
        frontend_host,
        frontend_port,
        backend_host,
        backend_port,
        backend_prefixes,
    ):
        self.proxy_port = proxy_port
        self.frontend = f"http://{frontend_host}:{frontend_port}"
        self.backend = f"http://{backend_host}:{backend_port}"
        self.backend_prefixes = tuple(backend_prefixes)
        self._loop = asyncio.new_event_loop()
        self._started = threading.Event()
        self._startup_error = None
        self._runner = None
        self._session = None
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self._thread.start()
        self._started.wait()
        if self._startup_error is not None:
            raise self._startup_error
        return self

    def _run(self):
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._start())
        except Exception as exc:
            if self._session is not None:
                self._loop.run_until_complete(self._session.close())
            self._startup_error = exc
            self._started.set()
            return

        self._started.set()
        self._loop.run_forever()

    async def _start(self):
        connector = TCPConnector(limit=200, limit_per_host=100, enable_cleanup_closed=True)
        self._session = ClientSession(
            connector=connector,
            timeout=ClientTimeout(total=None, connect=30, sock_connect=30),
            auto_decompress=False,
        )

        app = web.Application(client_max_size=1024**3)
        app.router.add_route("*", "/{path:.*}", self._handle_request)
        self._runner = web.AppRunner(app, access_log=None)
        await self._runner.setup()
        await web.TCPSite(self._runner, "0.0.0.0", self.proxy_port).start()

    def _target_url(self, request):
        base = self.backend if _should_use_backend(request.path, self.backend_prefixes) else self.frontend
        return base + request.raw_path

    async def _handle_request(self, request):
        target_url = self._target_url(request)

        if request.headers.get("Upgrade", "").lower() == "websocket":
            return await self._handle_websocket(request, target_url)

        request_body = request.content if request.can_read_body else None
        try:
            upstream = await self._session.request(
                request.method,
                target_url,
                headers=_forward_headers(request.headers),
                data=request_body,
                allow_redirects=False,
            )
        except Exception as exc:
            log(f"Tunnel proxy request failed: {exc}", "error")
            raise web.HTTPBadGateway(text="The upstream service is unavailable") from exc

        try:
            response = web.StreamResponse(
                status=upstream.status,
                reason=upstream.reason,
                headers=_forward_headers(upstream.headers),
            )
            await response.prepare(request)
            async for chunk in upstream.content.iter_chunked(65536):
                await response.write(chunk)
            await response.write_eof()
            return response
        except (ConnectionError, asyncio.CancelledError):
            raise
        finally:
            upstream.release()

    async def _handle_websocket(self, request, target_url):
        protocols = _websocket_protocols(request)
        ws_url = "ws" + target_url[4:]
        try:
            upstream = await self._session.ws_connect(
                ws_url,
                headers=_forward_headers(request.headers, websocket=True),
                protocols=protocols,
                autoping=False,
                autoclose=False,
            )
        except Exception as exc:
            log(f"Tunnel proxy WebSocket connection failed: {exc}", "error")
            raise web.HTTPBadGateway(text="The upstream WebSocket is unavailable") from exc

        downstream_protocols = [upstream.protocol] if upstream.protocol else ()
        downstream = web.WebSocketResponse(
            protocols=downstream_protocols,
            autoping=False,
            autoclose=False,
        )
        await downstream.prepare(request)

        relays = {
            asyncio.create_task(_relay_websocket(downstream, upstream)),
            asyncio.create_task(_relay_websocket(upstream, downstream)),
        }
        try:
            _, pending = await asyncio.wait(relays, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*relays, return_exceptions=True)
        finally:
            await upstream.close()
            await downstream.close()
        return downstream

    def close(self):
        if not self._loop.is_running():
            return
        future = asyncio.run_coroutine_threadsafe(self._close(), self._loop)
        future.result(timeout=10)
        self._loop.call_soon_threadsafe(self._loop.stop)

    async def _close(self):
        if self._session is not None:
            await self._session.close()
        if self._runner is not None:
            await self._runner.cleanup()


def start_proxy(
    proxy_port=9000,
    frontend_host="frontend",
    frontend_port=8223,
    backend_host="backend",
    backend_port=8226,
    backend_prefixes=("/api", "/ws", "/terminal"),
):
    log(
        f"Starting tunnel proxy on 0.0.0.0:{proxy_port} "
        f"(frontend={frontend_host}:{frontend_port}, backend={backend_host}:{backend_port})",
        "info",
    )
    proxy = TunnelProxy(
        proxy_port,
        frontend_host,
        frontend_port,
        backend_host,
        backend_port,
        backend_prefixes,
    ).start()
    log(f"Tunnel proxy listening on 0.0.0.0:{proxy_port}", "info")
    return proxy