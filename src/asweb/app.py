"""FastAPI backend and static frontend hosting for Antispice Web."""

import base64
import hashlib
import importlib.metadata
import json
import logging
import os
import threading
from collections import OrderedDict
from pathlib import Path
from time import perf_counter
from typing import Any, Literal
from uuid import uuid4

import antispice
import uvicorn
from antispice.circuit import Definition
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("asweb.backend")


def _integer_setting(name: str, default: int, *, minimum: int) -> int:
    """Read and validate one integer environment setting."""
    source = os.environ.get(name, str(default))
    try:
        value = int(source)
    except ValueError as error:
        message = f"{name} must be an integer"
        raise ValueError(message) from error
    if value < minimum:
        message = f"{name} must be at least {minimum}"
        raise ValueError(message)
    return value


class _CompileCache:
    """Small thread-safe LRU cache for generated compilation artifacts."""

    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self._entries: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> dict[str, Any] | None:
        """Return and promote an entry when present."""
        with self._lock:
            result = self._entries.get(key)
            if result is not None:
                self._entries.move_to_end(key)
            return result

    def put(self, key: str, result: dict[str, Any]) -> None:
        """Insert an entry and discard the least recently used excess entry."""
        if self.capacity == 0:
            return
        with self._lock:
            self._entries[key] = result
            self._entries.move_to_end(key)
            while len(self._entries) > self.capacity:
                self._entries.popitem(last=False)

    def clear(self) -> None:
        """Remove all entries, primarily for isolated tests."""
        with self._lock:
            self._entries.clear()


class _CompilationBusy(RuntimeError):
    """All configured compiler slots are occupied."""


_compile_cache = _CompileCache(_integer_setting("ASWEB_COMPILE_CACHE_SIZE", 16, minimum=0))
_compile_slots = threading.BoundedSemaphore(_integer_setting("ASWEB_MAX_CONCURRENT_COMPILES", 2, minimum=1))


def _configure_logging() -> None:
    """Configure backend logging in this process, including reload workers."""
    level_name = os.environ.get("ASWEB_LOG_LEVEL", "INFO").upper()
    level = logging.getLevelNamesMapping().get(level_name)
    if level is None:
        valid = "DEBUG, INFO, WARNING, ERROR, CRITICAL"
        message = f"invalid ASWEB_LOG_LEVEL {level_name!r}; expected one of: {valid}"
        raise ValueError(message)

    logger.setLevel(level)
    logger.propagate = False
    if not any(handler.get_name() == "asweb" for handler in logger.handlers):
        handler = logging.StreamHandler()
        handler.set_name("asweb")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        logger.addHandler(handler)


_configure_logging()


class ElementRequest(BaseModel):
    """One frontend element in electrical, rather than graphical, form."""

    model_config = ConfigDict(extra="forbid")

    reference: str = Field(min_length=1)
    use: str = Field(min_length=1)
    nodes: dict[str, str]
    parameters: dict[str, str | int | float] = Field(default_factory=dict)


class CompileRequest(BaseModel):
    """A versioned circuit compilation request."""

    model_config = ConfigDict(extra="forbid")

    version: int = 1
    elements: list[ElementRequest]


class ACInputRequest(BaseModel):
    """One frontend-only, ground-referenced small-signal excitation case."""

    model_config = ConfigDict(extra="forbid")

    reference: str = Field(min_length=1)
    type: Literal["current", "voltage"]
    net: str = Field(min_length=1)


class ACCompileRequest(CompileRequest):
    """Circuit compilation request carrying independent AC analysis cases."""

    inputs: list[ACInputRequest] = Field(min_length=1)


def _compile_cache_key(request: BaseModel) -> str:
    document = json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(document.encode()).hexdigest()


def _cached_compile_response(request: CompileRequest, compilation_id: str) -> dict[str, Any]:
    return _cached_response(request, compilation_id, lambda: _compile_response(request, compilation_id))


def _cached_ac_compile_response(request: ACCompileRequest, compilation_id: str) -> dict[str, Any]:
    return _cached_response(request, compilation_id, lambda: _ac_compile_response(request, compilation_id))


def _cached_response(request: BaseModel, compilation_id: str, compile_operation: Any) -> dict[str, Any]:
    key = _compile_cache_key(request)
    cached = _compile_cache.get(key)
    if cached is not None:
        logger.info("compile[%s] cache hit key=%s", compilation_id, key[:12])
        return cached

    if not _compile_slots.acquire(blocking=False):
        logger.warning("compile[%s] rejected because all compiler slots are occupied", compilation_id)
        raise _CompilationBusy
    try:
        # A compilation that held the slot may have populated this key while
        # this request was entering the endpoint.
        cached = _compile_cache.get(key)
        if cached is not None:
            logger.info("compile[%s] cache hit after admission key=%s", compilation_id, key[:12])
            return cached
        logger.info("compile[%s] cache miss key=%s", compilation_id, key[:12])
        result = compile_operation()
        _compile_cache.put(key, result)
        return result
    finally:
        _compile_slots.release()


def _encode_definition(definition: Definition) -> dict[str, Any]:
    if isinstance(definition, antispice.Model):
        return {
            "type": "model",
            "ports": list(definition.ports),
            "parameters": list(definition.parameters),
            "equations": list(definition.equations),
            "auxiliaries": dict(definition.auxiliaries),
        }
    return {
        "type": "part",
        "model": definition.model if isinstance(definition.model, str) else _encode_definition(definition.model),
        "parameters": dict(definition.parameters),
    }


def _make_circuit(request: CompileRequest) -> antispice.Circuit:
    if request.version != 1:
        message = f"unsupported circuit document version: {request.version}"
        raise ValueError(message)

    circuit = antispice.Circuit()
    for encoded in request.elements:
        if encoded.reference in circuit.elements:
            message = f"duplicate element reference: {encoded.reference!r}"
            raise ValueError(message)

        probe = antispice.Element(encoded.use, (), encoded.parameters)
        model = circuit.resolve_model(probe)
        missing_ports = [port for port in model.ports if port not in encoded.nodes]
        unknown_ports = sorted(set(encoded.nodes) - set(model.ports))
        if missing_ports:
            message = f"element {encoded.reference!r} is missing ports: {', '.join(missing_ports)}"
            raise ValueError(message)
        if unknown_ports:
            message = f"element {encoded.reference!r} has unknown ports: {', '.join(unknown_ports)}"
            raise ValueError(message)

        circuit.elements[encoded.reference] = antispice.Element(
            encoded.use,
            tuple(encoded.nodes[port] for port in model.ports),
            dict(encoded.parameters),
        )
    return circuit


def _library_response() -> dict[str, Any]:
    models = sum(isinstance(definition, antispice.Model) for definition in antispice.BUILTIN_LIBRARY.values())
    parts = len(antispice.BUILTIN_LIBRARY) - models
    logger.info("serving library definitions=%d models=%d parts=%d", len(antispice.BUILTIN_LIBRARY), models, parts)
    return {"definitions": {name: _encode_definition(definition) for name, definition in antispice.BUILTIN_LIBRARY.items()}}


def _compile_response(
    request: CompileRequest,
    compilation_id: str | None = None,
    *,
    ac_cases: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    compilation_id = compilation_id or uuid4().hex[:8]
    started = perf_counter()
    uses = {element.use for element in request.elements}
    logger.info(
        "compile[%s] started version=%d elements=%d definitions=%s",
        compilation_id,
        request.version,
        len(request.elements),
        sorted(uses),
    )
    for element in request.elements:
        logger.debug(
            "compile[%s] element reference=%s use=%s nodes=%s override_parameters=%s",
            compilation_id,
            element.reference,
            element.use,
            element.nodes,
            sorted(element.parameters),
        )

    circuit = _run_compile_stage(compilation_id, "request translation", lambda: _make_circuit(request))
    artifact = _run_compile_stage(
        compilation_id,
        "WebAssembly target compilation",
        lambda: antispice.compile_wasm(circuit, ac_cases=ac_cases),
    )
    state_size = artifact.layout.state_size
    logger.info(
        "compile[%s] solver states=%d newton_unknowns=%d",
        compilation_id,
        state_size,
        2 * state_size,
    )
    logger.info(
        "compile[%s] completed duration=%.3fs wasm_bytes=%d javascript_bytes=%d",
        compilation_id,
        perf_counter() - started,
        len(artifact.module),
        len(artifact.javascript.encode()),
    )
    return {
        "wasm": base64.b64encode(artifact.module).decode("ascii"),
        "javascript": artifact.javascript,
        "stateSize": artifact.layout.state_size,
        "layout": {
            "potentials": artifact.layout.potentials,
            "currents": artifact.layout.currents,
        },
    }


def _ac_compile_response(request: ACCompileRequest, compilation_id: str | None = None) -> dict[str, Any]:
    references = [item.reference for item in request.inputs]
    if len(set(references)) != len(references):
        message = "AC input references must be unique"
        raise ValueError(message)
    circuit = _make_circuit(request)
    nodes = {node for element in circuit.elements.values() for node in element.nodes}
    cases = []
    for item in request.inputs:
        if item.net == "0":
            message = f"AC input {item.reference!r} cannot drive the reference net"
            raise ValueError(message)
        if item.net not in nodes:
            message = f"AC input {item.reference!r} references unknown net {item.net!r}"
            raise ValueError(message)
        cases.append(item.model_dump(mode="json"))
    return _compile_response(request, compilation_id, ac_cases=cases)


def _run_compile_stage(compilation_id: str, name: str, operation: Any) -> Any:
    started = perf_counter()
    logger.info("compile[%s] stage=%s started", compilation_id, name)
    try:
        result = operation()
    except Exception:
        logger.exception("compile[%s] stage=%s failed duration=%.3fs", compilation_id, name, perf_counter() - started)
        raise
    logger.info("compile[%s] stage=%s completed duration=%.3fs", compilation_id, name, perf_counter() - started)
    return result


def create_app() -> FastAPI:
    """Create the API and mount its packaged static frontend."""
    application = FastAPI(title="Antispice Web", version=importlib.metadata.version(__package__))

    @application.middleware("http")
    async def log_request(request: Request, call_next: Any) -> Any:
        started = perf_counter()
        logger.info("request started method=%s path=%s", request.method, request.url.path)
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("request failed method=%s path=%s duration=%.3fs", request.method, request.url.path, perf_counter() - started)
            raise
        logger.info(
            "request completed method=%s path=%s status=%d duration=%.3fs",
            request.method,
            request.url.path,
            response.status_code,
            perf_counter() - started,
        )
        return response

    @application.get("/api/library")
    def library() -> dict[str, Any]:
        return _library_response()

    @application.post("/api/compile")
    def compile_circuit(request: CompileRequest) -> dict[str, Any]:
        compilation_id = uuid4().hex[:8]
        try:
            return _cached_compile_response(request, compilation_id)
        except _CompilationBusy as error:
            raise HTTPException(
                status_code=503,
                detail="all compiler slots are occupied; retry shortly",
                headers={"Retry-After": "1"},
            ) from error
        except (KeyError, TypeError, ValueError) as error:
            logger.warning("compile[%s] rejected error=%s", compilation_id, error)
            raise HTTPException(status_code=422, detail=str(error)) from error

    @application.post("/api/compile/ac")
    def compile_ac(request: ACCompileRequest) -> dict[str, Any]:
        compilation_id = uuid4().hex[:8]
        try:
            return _cached_ac_compile_response(request, compilation_id)
        except _CompilationBusy as error:
            raise HTTPException(
                status_code=503,
                detail="all compiler slots are occupied; retry shortly",
                headers={"Retry-After": "1"},
            ) from error
        except (KeyError, TypeError, ValueError) as error:
            logger.warning("compile[%s] rejected error=%s", compilation_id, error)
            raise HTTPException(status_code=422, detail=str(error)) from error

    frontend = Path(__file__).with_name("frontend")
    application.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return application


app = create_app()


def run() -> None:
    """Run the development server."""
    _configure_logging()
    uvicorn.run("asweb.app:app", host="127.0.0.1", port=8000, reload=True, log_config=None)
