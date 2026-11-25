"""Read-only, rate-limited Umbler Talk conversation collector.

Only the documented GET endpoints used below can be called. No media URL is
fetched, and the API token is read exclusively from the process environment.
"""

from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import sqlite3
import ssl
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener, HTTPSHandler


BASE_URL = "https://app-utalk.umbler.com/api"

def require_legacy_mode():
    """Avoid running a second collector against the same providers after cutover."""
    mode = os.environ.get('APP_MODE')
    env_path = Path(__file__).resolve().parents[3] / '.env'
    if mode is None and env_path.exists():
        for line in env_path.read_text(encoding='utf-8-sig').splitlines():
            if line.startswith('APP_MODE='):
                mode = line.split('=', 1)[1].strip().strip('"\'')
    if mode == 'mongo':
        raise SystemExit('Coletor legado desativado. Execute npm run sync:attendance para usar o Atlas.')

ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
WHATSAPP_TYPES = {
    "OrganizationBrokerWhatsappChannelReferenceModel",
    "OrganizationCloudAPIWhatsappChannelReferenceModel",
    "OrganizationGupshupWhatsappChannelReferenceModel",
    "OrganizationWhatsappChannelReferenceBaseModel",
}
PAGE_SIZE = 50
MESSAGE_PAGE_SIZE = 100
EXPORT_MESSAGE_PAGE_SIZE = 250
OVERLAP = timedelta(milliseconds=1)
FULL_HISTORY_START = datetime(1900, 1, 1, tzinfo=timezone.utc)
MAX_BODY_BYTES = 32 * 1024 * 1024


class CollectorError(Exception):
    pass


class BudgetExhausted(CollectorError):
    pass


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise CollectorError(f"A API retornou redirecionamento HTTP {code}; coleta interrompida.")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_utc(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            raise ValueError("timezone ausente")
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError, AttributeError) as exc:
        raise CollectorError("A API retornou uma data inválida; coleta interrompida.") from exc


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def valid_id(value: str, label: str) -> str:
    if not value or not ID_PATTERN.fullmatch(value):
        raise CollectorError(f"{label} inválido.")
    return value


def read_json_response(response):
    raw = response.read(MAX_BODY_BYTES + 1)
    if len(raw) > MAX_BODY_BYTES:
        raise CollectorError("Resposta da API excedeu 32 MiB; coleta interrompida.")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise CollectorError("A API não retornou JSON válido; coleta interrompida.") from exc


class TalkClient:
    def __init__(self, token: str, *, interval: float = 2.0, max_requests: int = 150,
                 timeout: float = 20.0, sleeper=time.sleep, clock=time.monotonic,
                 state_path: Path | None = None, wall_clock=time.time):
        token = token.strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not token or not token.isascii() or any(c.isspace() for c in token):
            raise CollectorError("Defina um token válido em UTALK_API_TOKEN.")
        if not math.isfinite(interval) or interval < 1.0:
            raise CollectorError("O intervalo mínimo permitido é 1 segundo.")
        if max_requests < 1 or max_requests > 1000:
            raise CollectorError("O orçamento deve estar entre 1 e 1000 requisições.")
        if not math.isfinite(timeout) or timeout <= 0:
            raise CollectorError("Timeout inválido.")
        self.token = token
        self.interval = interval
        self.max_requests = max_requests
        self.timeout = timeout
        self.sleeper = sleeper
        self.clock = clock
        self.wall_clock = wall_clock
        self.state_path = state_path
        self.attempts = 0
        self.next_allowed_at = 0.0
        if state_path is not None and state_path.exists():
            try:
                saved = json.loads(state_path.read_text(encoding="utf-8"))
                not_before = float(saved["not_before_epoch"])
                if not math.isfinite(not_before):
                    raise ValueError("invalid timestamp")
            except (OSError, ValueError, KeyError, TypeError) as exc:
                raise CollectorError("Estado local de espera inválido; nenhuma chamada foi feita.") from exc
            self.next_allowed_at = self.clock() + max(0.0, not_before - self.wall_clock())
        # Fixed HTTPS host; never follow a redirect carrying the bearer token.
        self.opener = build_opener(ProxyHandler({}), HTTPSHandler(context=ssl.create_default_context()), NoRedirects())

    @staticmethod
    def retry_after(headers) -> float | None:
        value = headers.get("Retry-After") if headers else None
        if not value:
            return None
        try:
            seconds = float(value)
            return max(0.0, seconds) if math.isfinite(seconds) else None
        except ValueError:
            try:
                return max(0.0, (parsedate_to_datetime(value) - utc_now()).total_seconds())
            except (TypeError, ValueError, OverflowError):
                return None

    def defer(self, seconds: float) -> None:
        self.next_allowed_at = max(self.next_allowed_at, self.clock() + seconds)
        if self.state_path is not None:
            not_before = self.wall_clock() + max(0.0, self.next_allowed_at - self.clock())
            temporary = self.state_path.with_suffix(".tmp")
            try:
                self.state_path.parent.mkdir(parents=True, exist_ok=True)
                with open(temporary, "w", encoding="utf-8") as file:
                    if os.name != "nt":
                        os.chmod(temporary, 0o600)
                    json.dump({"not_before_epoch": not_before}, file)
                    file.flush()
                    os.fsync(file.fileno())
                os.replace(temporary, self.state_path)
            except OSError as exc:
                raise CollectorError("Não foi possível salvar a espera local; coleta interrompida.") from exc

    def get(self, path: str, params: dict | None = None):
        if path not in ("/v1/members/me/", "/v1/channels/", "/v1/tags/", "/v1/chats/") and not (
            re.fullmatch(r"/v1/chats/[A-Za-z0-9_-]+/relative-messages/", path)
            or re.fullmatch(r"/v1/organizations/[A-Za-z0-9_-]+/", path)
            or path == "/v1/contact-ratings/"
        ):
            raise CollectorError("Rota fora da lista de leitura permitida.")
        url = BASE_URL + path
        if params:
            url += "?" + urlencode(params, doseq=True)
        for retry in range(5):
            if self.attempts >= self.max_requests:
                raise BudgetExhausted("Limite de requisições desta execução atingido.")
            wait = self.next_allowed_at - self.clock()
            if wait > 300:
                raise CollectorError(f"A API exige mais {math.ceil(wait)} segundos de espera; tente depois desse prazo.")
            if wait > 0:
                self.sleeper(wait)
            self.defer(self.interval)
            self.attempts += 1
            request = Request(url, headers={
                "Authorization": "Bearer " + self.token,
                "Accept": "application/json",
                "User-Agent": "utalk-readonly-collector/1.0",
            }, method="GET")
            try:
                with self.opener.open(request, timeout=self.timeout) as response:
                    return read_json_response(response)
            except HTTPError as exc:
                status = exc.code
                headers = exc.headers
                exc.close()
                if status in (401, 403):
                    raise CollectorError(f"HTTP {status}: token, plano ou permissão sem acesso.") from exc
                if status == 400:
                    raise CollectorError("HTTP 400: parâmetros rejeitados pela API; coleta interrompida.") from exc
                if status not in (429, 500, 502, 503, 504):
                    raise CollectorError(f"HTTP {status}: coleta interrompida.") from exc
                delay = self.retry_after(headers)
                if delay is None:
                    delay = min(60.0, 2 ** (retry + 1) + random.random())
                # Persist even the last retry's cooldown, so restarting cannot skip it.
                self.defer(max(delay, self.interval))
                if delay > 300:
                    raise CollectorError(f"HTTP {status}: aguarde {math.ceil(delay)} segundos antes de tentar novamente.") from exc
                if retry == 4:
                    raise CollectorError(f"HTTP {status} persistiu após 5 tentativas.") from exc
                print(f"HTTP {status}: aguardando {math.ceil(max(delay, self.interval))} segundos antes de repetir.")
            except (URLError, TimeoutError, OSError) as exc:
                self.defer(min(60.0, 2 ** (retry + 1) + random.random()))
                if retry == 4:
                    raise CollectorError("Falha de rede persistiu após 5 tentativas.") from exc
        raise AssertionError("unreachable")


def connect_db(path: Path) -> sqlite3.Connection:
    parent_existed = path.parent.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.name != "nt" and not parent_existed:
        path.parent.chmod(0o700)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    if os.name != "nt":
        path.chmod(0o600)
    connection.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS channels (
            organization_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
            raw_json TEXT NOT NULL, PRIMARY KEY (organization_id, id)
        );
        CREATE TABLE IF NOT EXISTS chats (
            organization_id TEXT NOT NULL, id TEXT NOT NULL, channel_id TEXT NOT NULL,
            raw_json TEXT NOT NULL, PRIMARY KEY (organization_id, id)
        );
        CREATE TABLE IF NOT EXISTS messages (
            organization_id TEXT NOT NULL, chat_id TEXT NOT NULL, id TEXT NOT NULL,
            event_at_utc TEXT NOT NULL, raw_json TEXT NOT NULL,
            PRIMARY KEY (organization_id, chat_id, id)
        );
        CREATE INDEX IF NOT EXISTS messages_by_chat_time
            ON messages (organization_id, chat_id, event_at_utc);
        CREATE TABLE IF NOT EXISTS chat_sync (
            organization_id TEXT NOT NULL, chat_id TEXT NOT NULL,
            backfill_cursor TEXT NOT NULL, forward_cursor TEXT NOT NULL,
            backfill_complete INTEGER NOT NULL DEFAULT 0,
            history_limited INTEGER NOT NULL DEFAULT 0,
            last_checked_at TEXT,
            PRIMARY KEY (organization_id, chat_id)
        );
        CREATE TABLE IF NOT EXISTS discovery (
            organization_id TEXT PRIMARY KEY, cutoff_utc TEXT NOT NULL,
            next_skip INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS export_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL, days INTEGER NOT NULL,
            from_utc TEXT NOT NULL, until_utc TEXT NOT NULL,
            filter_tag_id TEXT, filter_tag_name TEXT,
            status TEXT NOT NULL DEFAULT 'collecting',
            created_at_utc TEXT NOT NULL, completed_at_utc TEXT,
            file_path TEXT
        );
        CREATE INDEX IF NOT EXISTS export_runs_by_org
            ON export_runs (organization_id, id DESC);
        CREATE TABLE IF NOT EXISTS export_chat_candidates (
            run_id INTEGER NOT NULL, chat_id TEXT NOT NULL,
            PRIMARY KEY (run_id, chat_id)
        );
        CREATE TABLE IF NOT EXISTS export_discovery (
            run_id INTEGER PRIMARY KEY, cutoff_utc TEXT NOT NULL,
            next_skip INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0,
            last_page_signature TEXT
        );
        CREATE TABLE IF NOT EXISTS export_chat_progress (
            run_id INTEGER NOT NULL, organization_id TEXT NOT NULL, chat_id TEXT NOT NULL,
            cursor_utc TEXT NOT NULL, complete INTEGER NOT NULL DEFAULT 0,
            history_limited INTEGER NOT NULL DEFAULT 0,
            last_page_signature TEXT,
            PRIMARY KEY (run_id, chat_id)
        );
        CREATE TABLE IF NOT EXISTS export_messages (
            run_id INTEGER NOT NULL, organization_id TEXT NOT NULL, chat_id TEXT NOT NULL,
            id TEXT NOT NULL, event_at_utc TEXT NOT NULL, raw_json TEXT NOT NULL,
            PRIMARY KEY (run_id, chat_id, id)
        );
        CREATE INDEX IF NOT EXISTS export_messages_by_run_time
            ON export_messages (run_id, event_at_utc, chat_id);
    """)
    # Additive migrations preserve databases created by the first collector version.
    columns = {row[1] for row in connection.execute("PRAGMA table_info(chat_sync)")}
    if "forward_pending" not in columns:
        connection.execute("ALTER TABLE chat_sync ADD COLUMN forward_pending INTEGER NOT NULL DEFAULT 0")
    columns = {row[1] for row in connection.execute("PRAGMA table_info(discovery)")}
    if "last_page_signature" not in columns:
        connection.execute("ALTER TABLE discovery ADD COLUMN last_page_signature TEXT")
    columns = {row[1] for row in connection.execute("PRAGMA table_info(export_runs)")}
    if "filter_tag_id" not in columns:
        connection.execute("ALTER TABLE export_runs ADD COLUMN filter_tag_id TEXT")
    if "filter_tag_name" not in columns:
        connection.execute("ALTER TABLE export_runs ADD COLUMN filter_tag_name TEXT")
    connection.commit()
    return connection


def runtime_state_path() -> Path:
    root = Path(os.environ["LOCALAPPDATA"]) if os.environ.get("LOCALAPPDATA") else Path.home() / ".local" / "state"
    return root / "UmblerTalkReader" / "http_state.json"


@contextmanager
def single_process_lock(db_path: Path):
    lock_path = db_path.with_suffix(db_path.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        if os.name == "nt":
            import msvcrt
            if os.fstat(fd).st_size == 0:
                os.write(fd, b"0")
            os.lseek(fd, 0, os.SEEK_SET)
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise CollectorError("Já existe outra execução do coletor usando esta trava.") from exc
        else:
            import fcntl
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise CollectorError("Já existe outra execução do coletor usando esta trava.") from exc
        yield
    finally:
        os.close(fd)


def json_text(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def channel_id(chat: dict) -> str | None:
    channel = chat.get("channel")
    return channel.get("id") if isinstance(channel, dict) else None


def save_messages(db: sqlite3.Connection, org_id: str, chat_id: str, response: dict) -> tuple[int, datetime | None, datetime | None]:
    entries = response.get("messages")
    if not isinstance(entries, list):
        raise CollectorError("Resposta de mensagens fora do formato documentado.")
    oldest = newest = None
    saved = 0
    for message in entries:
        if not isinstance(message, dict) or not isinstance(message.get("id"), str) or not isinstance(message.get("eventAtUTC"), str):
            raise CollectorError("Mensagem sem ID ou eventAtUTC; coleta interrompida sem avançar cursor.")
        date = parse_utc(message["eventAtUTC"])
        oldest = date if oldest is None else min(oldest, date)
        newest = date if newest is None else max(newest, date)
        db.execute("""INSERT INTO messages VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, chat_id, id) DO UPDATE SET
            event_at_utc=excluded.event_at_utc, raw_json=excluded.raw_json""",
            (org_id, chat_id, message["id"], iso_utc(date), json_text(message)))
        saved += 1
    return saved, oldest, newest


def get_message_page(client: TalkClient, org_id: str, chat_id: str, cursor: str,
                     direction: str, *, take: int = MESSAGE_PAGE_SIZE) -> dict:
    if not 1 <= take <= EXPORT_MESSAGE_PAGE_SIZE:
        raise CollectorError("Quantidade de mensagens por página fora do limite documentado.")
    response = client.get(f"/v1/chats/{valid_id(chat_id, 'ID do chat')}/relative-messages/", {
        "organizationId": org_id,
        "FromEventUTC": cursor,
        "Take": take,
        "Direction": direction,
        "IncludeMetadata": "false",
    })
    if not isinstance(response, dict) or not isinstance(response.get("messages"), list):
        raise CollectorError("Resposta de mensagens fora do formato documentado.")
    if len(response["messages"]) > take:
        raise CollectorError("A API retornou mais mensagens que Take; cursor não será avançado.")
    if "hasMessagesBeforeAllowedOrganizationPlan" in response and not isinstance(response["hasMessagesBeforeAllowedOrganizationPlan"], bool):
        raise CollectorError("Indicador de limite do plano fora do formato documentado.")
    return response


def sync_one_chat(db: sqlite3.Connection, client: TalkClient, org_id: str, chat_id: str,
                  *, max_pages: int = 4) -> tuple[int, bool]:
    state = db.execute("SELECT * FROM chat_sync WHERE organization_id=? AND chat_id=?", (org_id, chat_id)).fetchone()
    if state is None:
        cursor = iso_utc(utc_now())
        with db:
            db.execute("INSERT INTO chat_sync (organization_id, chat_id, backfill_cursor, forward_cursor) VALUES (?, ?, ?, ?)",
                       (org_id, chat_id, cursor, cursor))
        new_chat = True
    else:
        new_chat = False
    pages = 0
    saved = 0
    # On later runs, catch new messages before spending the per-chat budget on history.
    if not new_chat:
        while pages < min(2, max_pages):
            state = db.execute("SELECT * FROM chat_sync WHERE organization_id=? AND chat_id=?", (org_id, chat_id)).fetchone()
            response = get_message_page(client, org_id, chat_id, iso_utc(parse_utc(state["forward_cursor"]) - OVERLAP), "TakeAfter")
            entries = response.get("messages")
            with db:
                count, _, newest = save_messages(db, org_id, chat_id, response)
                saved += count
                if len(entries) == MESSAGE_PAGE_SIZE and (newest is None or newest <= parse_utc(state["forward_cursor"])):
                    raise CollectorError("Página de mensagens novas saturada no mesmo horário; cursor não avançou.")
                if newest is not None and newest > parse_utc(state["forward_cursor"]):
                    db.execute("UPDATE chat_sync SET forward_cursor=? WHERE organization_id=? AND chat_id=?",
                               (iso_utc(newest), org_id, chat_id))
                db.execute("UPDATE chat_sync SET forward_pending=?, history_limited=? WHERE organization_id=? AND chat_id=?",
                           (int(len(entries) == MESSAGE_PAGE_SIZE),
                            int(bool(state["history_limited"] or response.get("hasMessagesBeforeAllowedOrganizationPlan"))),
                            org_id, chat_id))
            pages += 1
            if len(entries) < MESSAGE_PAGE_SIZE:
                break

    while pages < max_pages:
        state = db.execute("SELECT * FROM chat_sync WHERE organization_id=? AND chat_id=?", (org_id, chat_id)).fetchone()
        if state["backfill_complete"]:
            break
        response = get_message_page(client, org_id, chat_id, state["backfill_cursor"], "TakeBefore")
        entries = response.get("messages")
        with db:
            count, oldest, _ = save_messages(db, org_id, chat_id, response)
            saved += count
            finished = len(entries) < MESSAGE_PAGE_SIZE
            if oldest is not None:
                next_cursor = iso_utc(oldest + OVERLAP)
                if next_cursor >= state["backfill_cursor"] and not finished:
                    raise CollectorError("Página de histórico saturada no mesmo horário; cursor não avançou.")
                db.execute("UPDATE chat_sync SET backfill_cursor=? WHERE organization_id=? AND chat_id=?",
                           (next_cursor, org_id, chat_id))
            db.execute("UPDATE chat_sync SET backfill_complete=?, history_limited=? WHERE organization_id=? AND chat_id=?",
                       (int(finished), int(bool(state["history_limited"] or response.get("hasMessagesBeforeAllowedOrganizationPlan"))), org_id, chat_id))
        pages += 1
        if finished:
            break

    with db:
        db.execute("UPDATE chat_sync SET last_checked_at=? WHERE organization_id=? AND chat_id=?",
                   (iso_utc(utc_now()), org_id, chat_id))
    complete = bool(db.execute("SELECT backfill_complete FROM chat_sync WHERE organization_id=? AND chat_id=?",
                               (org_id, chat_id)).fetchone()[0])
    return saved, complete


def discover(db: sqlite3.Connection, client: TalkClient, org_id: str,
             whatsapp_ids: set[str], *, refresh: bool = False,
             cutoff_utc: str | None = None, tag_id: str | None = None,
             export_run_id: int | None = None,
             candidate_start_utc: str | None = None) -> None:
    if tag_id is not None and export_run_id is None:
        raise CollectorError("Filtro de etiqueta da exportação incompleto.")
    table = "discovery" if export_run_id is None else "export_discovery"
    key_column = "organization_id" if export_run_id is None else "run_id"
    key_value = org_id if export_run_id is None else export_run_id
    state = db.execute(f"SELECT * FROM {table} WHERE {key_column}=?", (key_value,)).fetchone()
    if state is not None and state["complete"] and not refresh:
        return
    if state is None or refresh:
        cutoff = cutoff_utc or iso_utc(utc_now())
        with db:
            if export_run_id is None:
                db.execute("INSERT INTO discovery (organization_id, cutoff_utc, next_skip, complete) VALUES (?, ?, 0, 0) ON CONFLICT(organization_id) DO UPDATE SET cutoff_utc=excluded.cutoff_utc, next_skip=0, complete=0, last_page_signature=NULL",
                           (org_id, cutoff))
            else:
                db.execute("INSERT INTO export_discovery (run_id, cutoff_utc, next_skip, complete) VALUES (?, ?, 0, 0) ON CONFLICT(run_id) DO UPDATE SET cutoff_utc=excluded.cutoff_utc, next_skip=0, complete=0, last_page_signature=NULL",
                           (export_run_id, cutoff))
        state = db.execute(f"SELECT * FROM {table} WHERE {key_column}=?", (key_value,)).fetchone()

    while True:
        params = {
            "organizationId": org_id,
            "ChatState": "All",
            "ContactTypes": ["DirectMessage", "Group"],
            "ChatOrderBy": "LastMessage" if export_run_id is not None and tag_id is None else "CreatedAtUTC",
            "Order": "Desc" if export_run_id is not None and tag_id is None else "Asc",
            "DateEndCreatedAtUTC": state["cutoff_utc"],
            "IncludePinneds": "false" if export_run_id is not None else "true",
            "Behavior": "GetSliceOnly",
            "Skip": state["next_skip"],
            "Take": PAGE_SIZE,
        }
        if tag_id is not None:
            params["Tags.Rule"] = "ContainsAny"
            params["Tags.Values"] = [tag_id]
        response = client.get("/v1/chats/", params)
        if not isinstance(response, dict) or not isinstance(response.get("items"), list):
            raise CollectorError("Listagem de chats fora do formato documentado.")
        items = response["items"]
        page = response.get("page") or {}
        if not isinstance(page, dict):
            raise CollectorError("Metadados da paginação fora do formato documentado.")
        if "took" in page and page["took"] != len(items):
            raise CollectorError("Contagem da página diverge dos chats recebidos; coleta interrompida.")
        if "skipped" in page and page["skipped"] != state["next_skip"]:
            raise CollectorError("A API não confirmou o offset solicitado; coleta interrompida.")
        ids = []
        for chat in items:
            if not isinstance(chat, dict) or not isinstance(chat.get("id"), str) or not chat["id"]:
                raise CollectorError("Chat sem ID na listagem; coleta interrompida.")
            ids.append(chat["id"])
        signature = hashlib.sha256(json.dumps(sorted(ids)).encode("utf-8")).hexdigest()
        if items and signature == state["last_page_signature"]:
            raise CollectorError("A API repetiu a mesma página de chats; coleta interrompida para evitar um loop.")
        total = page.get("totalItems")
        next_skip = state["next_skip"] + len(items)
        # GetSliceOnly does not request a total count; never use totalItems to end the scan.
        finished = not items
        if items and export_run_id is not None and tag_id is None and candidate_start_utc is not None:
            last_times = []
            for chat in items:
                last_message = chat.get("lastMessage")
                last_value = last_message.get("eventAtUTC") if isinstance(last_message, dict) else None
                if not isinstance(last_value, str):
                    last_times = []
                    break
                try:
                    last_times.append(parse_utc(last_value))
                except (TypeError, ValueError):
                    last_times = []
                    break
            # ChatOrderBy=LastMessage and Order=Desc are documented enum values.
            # Once an entire page predates the window, all following pages do too.
            if last_times and max(last_times) < parse_utc(candidate_start_utc):
                finished = True
        with db:
            for chat in items:
                cid = channel_id(chat)
                if cid in whatsapp_ids:
                    db.execute("""INSERT INTO chats VALUES (?, ?, ?, ?)
                        ON CONFLICT(organization_id, id) DO UPDATE SET channel_id=excluded.channel_id, raw_json=excluded.raw_json""",
                        (org_id, chat["id"], cid, json_text(chat)))
                    if export_run_id is not None:
                        include = True
                        if tag_id is not None:
                            # Verify the server-side filter in the returned chat as a guard
                            # against exporting unrelated conversations if API behavior changes.
                            chat_tags = chat.get("tags")
                            contact = chat.get("contact")
                            contact_tags = contact.get("tags") if isinstance(contact, dict) else None
                            tag_refs = [
                                tag for group in (chat_tags, contact_tags) if isinstance(group, list)
                                for tag in group if isinstance(tag, dict)
                            ]
                            if not any(tag.get("id") == tag_id for tag in tag_refs):
                                returned_ids = [tag.get("id") for tag in tag_refs]
                                raise CollectorError(f"A API não confirmou a etiqueta solicitada no chat ou contato (id esperado {tag_id}; ids recebidos {returned_ids}); exportação interrompida.")
                        if candidate_start_utc is not None:
                            # The API has no documented filter for last-message time. Scan all
                            # chats, then avoid one message request for historical chats whose
                            # latest visible message predates the requested window. Missing or
                            # invalid timestamps are included conservatively.
                            last_message = chat.get("lastMessage")
                            last_value = last_message.get("eventAtUTC") if isinstance(last_message, dict) else None
                            if isinstance(last_value, str):
                                try:
                                    include = parse_utc(last_value) >= parse_utc(candidate_start_utc)
                                except (TypeError, ValueError):
                                    include = True
                        if include:
                            db.execute("INSERT OR IGNORE INTO export_chat_candidates VALUES (?, ?)",
                                       (export_run_id, chat["id"]))
            db.execute(f"UPDATE {table} SET next_skip=?, complete=?, last_page_signature=? WHERE {key_column}=?",
                       (next_skip, int(finished), signature, key_value))
        reported_total = total if isinstance(total, int) and total > 0 else "?"
        count = db.execute("SELECT COUNT(*) FROM export_chat_candidates WHERE run_id=?",
                           (export_run_id,)).fetchone()[0] if export_run_id is not None else \
                db.execute("SELECT COUNT(*) FROM chats WHERE organization_id=?", (org_id,)).fetchone()[0]
        print(f"Descoberta: {next_skip}/{reported_total} chats filtrados examinados; "
              f"{count} chats WhatsApp correspondentes.", flush=True)
        if finished:
            return
        state = db.execute(f"SELECT * FROM {table} WHERE {key_column}=?", (key_value,)).fetchone()


def list_tags(client: TalkClient, org_id: str) -> list[dict]:
    tags: list[dict] = []
    skip = 0
    previous_signature = None
    while True:
        response = client.get("/v1/tags/", {
            "organizationId": org_id,
            "Behavior": "GetSliceOnly",
            "Skip": skip,
            "Take": PAGE_SIZE,
        })
        if not isinstance(response, dict) or not isinstance(response.get("items"), list):
            raise CollectorError("Lista de etiquetas fora do formato documentado.")
        items = response["items"]
        page = response.get("page") or {}
        if not isinstance(page, dict):
            raise CollectorError("Metadados da paginação de etiquetas fora do formato documentado.")
        if "took" in page and page["took"] != len(items):
            raise CollectorError("Contagem da página de etiquetas diverge da resposta; coleta interrompida.")
        if "skipped" in page and page["skipped"] != skip:
            raise CollectorError("A API não confirmou o offset de etiquetas; coleta interrompida.")
        for tag in items:
            if not isinstance(tag, dict) or not isinstance(tag.get("id"), str) or not isinstance(tag.get("name"), str):
                raise CollectorError("Etiqueta sem ID ou nome na listagem; exportação interrompida.")
        signature = hashlib.sha256(json.dumps([tag["id"] for tag in items]).encode("utf-8")).hexdigest()
        if items and signature == previous_signature:
            raise CollectorError("A API repetiu uma página de etiquetas; coleta interrompida para evitar um loop.")
        if not items:
            return tags
        tags.extend(items)
        skip += len(items)
        previous_signature = signature


def find_tag(tags: list[dict], requested_name: str) -> dict:
    matches = [tag for tag in tags if tag["name"].strip().casefold() == requested_name.strip().casefold()]
    if not matches:
        raise CollectorError(f"A etiqueta '{requested_name}' não foi encontrada na organização.")
    if len(matches) > 1:
        raise CollectorError(f"Há {len(matches)} etiquetas com o nome '{requested_name}'; resolva a ambiguidade na Umbler antes de exportar.")
    return matches[0]


def export_run_for(db: sqlite3.Connection, org_id: str, days: int,
                   tag_id: str | None, tag_name: str, *, from_utc: str | None = None,
                   until_utc: str | None = None) -> tuple[sqlite3.Row, bool]:
    exact_window = from_utc is not None or until_utc is not None
    if exact_window and (from_utc is None or until_utc is None):
        raise CollectorError("Informe --from-utc e --until-utc juntos.")
    if exact_window:
        start = parse_utc(from_utc)
        until = parse_utc(until_utc)
        if start >= until:
            raise CollectorError("O início da exportação deve ser anterior ao fim.")
    else:
        until = utc_now()
        start = FULL_HISTORY_START if days == 0 else until - timedelta(days=days)
    normalized_from = iso_utc(start)
    normalized_until = iso_utc(until)
    active_runs = db.execute("SELECT * FROM export_runs WHERE organization_id=? AND status='collecting' ORDER BY id DESC",
                             (org_id,)).fetchall()
    active = next((row for row in active_runs if row["filter_tag_id"] == tag_id and row["days"] == days and
                   (not exact_window or (row["from_utc"] == normalized_from and row["until_utc"] == normalized_until))), None)
    if active:
        with db:
            db.execute("UPDATE export_runs SET filter_tag_name=? WHERE id=?", (tag_name, active["id"]))
            for row in active_runs:
                if row["id"] != active["id"]:
                    db.execute("UPDATE export_runs SET status='superseded', completed_at_utc=? WHERE id=?",
                               (iso_utc(utc_now()), row["id"]))
        return db.execute("SELECT * FROM export_runs WHERE id=?", (active["id"],)).fetchone(), False
    with db:
        for row in active_runs:
            db.execute("UPDATE export_runs SET status='superseded', completed_at_utc=? WHERE id=?",
                       (iso_utc(utc_now()), row["id"]))
    with db:
        cursor = db.execute("""INSERT INTO export_runs
            (organization_id, days, from_utc, until_utc, filter_tag_id, filter_tag_name,
             created_at_utc, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'collecting')""",
            (org_id, days, normalized_from, normalized_until, tag_id, tag_name, iso_utc(utc_now())))
    return db.execute("SELECT * FROM export_runs WHERE id=?", (cursor.lastrowid,)).fetchone(), True


def sync_export_chat(db: sqlite3.Connection, client: TalkClient, run: sqlite3.Row,
                     chat_id: str) -> tuple[int, bool]:
    run_id = run["id"]
    org_id = run["organization_id"]
    start = parse_utc(run["from_utc"])
    state = db.execute("SELECT * FROM export_chat_progress WHERE run_id=? AND chat_id=?",
                       (run_id, chat_id)).fetchone()
    if state is None:
        initial_cursor = iso_utc(parse_utc(run["until_utc"]) + OVERLAP)
        with db:
            db.execute("""INSERT INTO export_chat_progress
                (run_id, organization_id, chat_id, cursor_utc)
                VALUES (?, ?, ?, ?)""", (run_id, org_id, chat_id, initial_cursor))
        state = db.execute("SELECT * FROM export_chat_progress WHERE run_id=? AND chat_id=?",
                           (run_id, chat_id)).fetchone()
    if state["complete"]:
        return 0, True

    response = get_message_page(client, org_id, chat_id, state["cursor_utc"],
                                "TakeBefore", take=EXPORT_MESSAGE_PAGE_SIZE)
    entries = response["messages"]
    parsed: list[tuple[dict, datetime]] = []
    for message in entries:
        if not isinstance(message, dict) or not isinstance(message.get("id"), str) or not message["id"]:
            raise CollectorError("Mensagem sem ID válido; cursor do chat preservado.")
        if not isinstance(message.get("eventAtUTC"), str):
            raise CollectorError("Mensagem sem eventAtUTC; cursor do chat preservado.")
        parsed.append((message, parse_utc(message["eventAtUTC"])))
    oldest = min((stamp for _, stamp in parsed), default=None)
    newest = max((stamp for _, stamp in parsed), default=None)
    signature = hashlib.sha256("\n".join(sorted(m["id"] for m, _ in parsed)).encode("utf-8")).hexdigest()

    if len(entries) == EXPORT_MESSAGE_PAGE_SIZE and state["last_page_signature"] == signature:
        raise CollectorError(f"O chat {chat_id} repetiu a mesma página no limite de data; parei sem declarar a exportação completa.")
    if len(entries) == EXPORT_MESSAGE_PAGE_SIZE and oldest == start:
        raise CollectorError(f"O chat {chat_id} tem 250 mensagens na mesma fronteira de data; a API não oferece desempate por ID para garantir que nenhuma fique de fora.")
    if len(entries) == EXPORT_MESSAGE_PAGE_SIZE and oldest is not None and newest == oldest:
        raise CollectorError(f"O chat {chat_id} tem 250 mensagens no mesmo horário; a API não oferece desempate por ID para continuar com segurança.")

    within_range = [(message, stamp) for message, stamp in parsed if start <= stamp <= parse_utc(run["until_utc"])]
    finished = not entries or len(entries) < EXPORT_MESSAGE_PAGE_SIZE or (oldest is not None and oldest < start)
    next_cursor = iso_utc(oldest + OVERLAP) if oldest is not None else state["cursor_utc"]
    limited = int(bool(state["history_limited"] or response.get("hasMessagesBeforeAllowedOrganizationPlan", False)))
    with db:
        for message, stamp in within_range:
            if message.get("isPrivate") is True:
                continue
            db.execute("""INSERT INTO export_messages
                (run_id, organization_id, chat_id, id, event_at_utc, raw_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id, chat_id, id) DO UPDATE SET
                event_at_utc=excluded.event_at_utc, raw_json=excluded.raw_json""",
                (run_id, org_id, chat_id, message["id"], iso_utc(stamp), json_text(message)))
        db.execute("""UPDATE export_chat_progress SET cursor_utc=?, complete=?,
            history_limited=?, last_page_signature=? WHERE run_id=? AND chat_id=?""",
            (next_cursor, int(finished), limited, signature if entries else None, run_id, chat_id))
    return len(within_range), finished


def message_text(message: dict) -> str:
    pieces = []
    if message.get("content"):
        pieces.append(str(message["content"]))
    file_info = message.get("file")
    if isinstance(file_info, dict):
        name = file_info.get("originalName")
        caption = file_info.get("caption")
        transcription = file_info.get("transcription")
        if name:
            pieces.append(f"[Arquivo: {name}]")
        elif not caption and not transcription:
            pieces.append("[Arquivo de mídia]")
        if caption:
            pieces.append(f"Legenda: {caption}")
        if transcription:
            pieces.append(f"Transcrição: {transcription}")
    return " ".join(pieces).strip() or "[Mensagem sem texto]"


def write_export_chat(db: sqlite3.Connection, run: sqlite3.Row,
                      chat_id: str, output_dir: Path) -> Path:
    run_id = run["id"]
    row = db.execute("""SELECT c.raw_json, p.history_limited
        FROM export_chat_candidates e
        LEFT JOIN chats c ON c.organization_id=? AND c.id=e.chat_id
        JOIN export_chat_progress p ON p.run_id=e.run_id AND p.chat_id=e.chat_id
        WHERE e.run_id=? AND e.chat_id=?""",
        (run["organization_id"], run_id, chat_id)).fetchone()
    if row is None:
        raise CollectorError("Chat fora da lista de exportação confirmada.")
    chat = json.loads(row["raw_json"]) if row["raw_json"] else {}
    contact = chat.get("contact") if isinstance(chat, dict) else None
    contact = contact if isinstance(contact, dict) else {}
    label = str(contact.get("name") or contact.get("phoneNumber") or "Contato sem nome")
    phone = contact.get("phoneNumber")
    safe_label = re.sub(r"[^A-Za-z0-9]+", "_", label).strip("_").lower()[:50] or "contato"
    safe_chat_id = re.sub(r"[^A-Za-z0-9_-]", "_", chat_id)
    output_dir.mkdir(parents=True, exist_ok=True)
    prefix = "google_ads" if run["filter_tag_id"] else "whatsapp"
    output_path = output_dir / f"{prefix}_{safe_label}_{safe_chat_id}.txt"
    fd, temp_name = tempfile.mkstemp(prefix=".utalk-export-", suffix=".tmp", dir=output_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as file:
            file.write("CONVERSA — UMBLER TALK\n")
            file.write(f"Contato: {label}" + (f" ({phone})" if phone and phone != label else "") + "\n")
            file.write(f"Chat ID: {chat_id}\n")
            file.write(f"Etiqueta: {run['filter_tag_name']}\n")
            if run["days"] == 0:
                file.write(f"Período UTC: histórico disponível até {run['until_utc']}\n")
            else:
                file.write(f"Período UTC: {run['from_utc']} a {run['until_utc']}\n")
            if row["history_limited"]:
                file.write("A API sinalizou limite de histórico do plano para esta conversa.\n")
            file.write("-" * 72 + "\n")
            messages = db.execute("""SELECT raw_json FROM export_messages
                WHERE run_id=? AND chat_id=? ORDER BY event_at_utc, id""", (run_id, chat_id))
            visible = 0
            for item in messages:
                message = json.loads(item["raw_json"])
                if message.get("isPrivate") is True:
                    continue
                event_at = parse_utc(message["eventAtUTC"]).strftime("%Y-%m-%d %H:%M:%S UTC")
                sender = "Atendente" if message.get("sentByOrganizationMember") else "Cliente"
                prefix = message.get("prefix")
                if prefix:
                    sender = f"{sender} — {prefix}"
                file.write(f"[{event_at}] {sender}: {message_text(message)}\n")
                visible += 1
            if not visible:
                file.write("Nenhuma mensagem WhatsApp disponível.\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp_name, output_path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise
    return output_path


def finish_export(db: sqlite3.Connection, run: sqlite3.Row, output_dir: Path) -> tuple[int, int, int]:
    pending = db.execute("SELECT COUNT(*) FROM export_chat_progress WHERE run_id=? AND complete=0",
                         (run["id"],)).fetchone()[0]
    if pending:
        raise CollectorError("Ainda há conversas pendentes; exportação final não foi concluída.")
    chat_count = db.execute("SELECT COUNT(*) FROM export_chat_candidates WHERE run_id=?",
                            (run["id"],)).fetchone()[0]
    messages = db.execute("SELECT COUNT(*) FROM export_messages WHERE run_id=?",
                          (run["id"],)).fetchone()[0]
    limited = db.execute("SELECT COUNT(*) FROM export_chat_progress WHERE run_id=? AND history_limited=1",
                         (run["id"],)).fetchone()[0]
    with db:
        db.execute("UPDATE export_runs SET status='complete', completed_at_utc=?, file_path=? WHERE id=?",
                   (iso_utc(utc_now()), str(output_dir), run["id"]))
    return chat_count, messages, limited


def run_tag_export(db: sqlite3.Connection, client: TalkClient, org_id: str,
                   days: int, tag_name: str | None, output_dir: Path, *,
                   from_utc: str | None = None, until_utc: str | None = None) -> None:
    if tag_name is None:
        tag_id = None
        tag_name = "Todos os canais WhatsApp"
    else:
        tag = find_tag(list_tags(client, org_id), tag_name)
        tag_id = valid_id(tag["id"], "ID da etiqueta")
        tag_name = tag["name"]
    run, is_new = export_run_for(db, org_id, days, tag_id, tag_name,
                                 from_utc=from_utc, until_utc=until_utc)
    if from_utc is not None:
        scope = f"{run['from_utc']} a {run['until_utc']}"
    else:
        scope = "todo o histórico disponível" if days == 0 else f"os últimos {days} dias"
    if is_new:
        print(f"Exportação {run['id']} iniciada para a etiqueta {tag_name}; escopo: {scope}; corte UTC {run['until_utc']}.", flush=True)
    else:
        print(f"Retomando exportação {run['id']} para a etiqueta {tag_name}; escopo: {scope}; corte UTC {run['until_utc']}.", flush=True)
    channels = list_channels(client, org_id)
    whatsapp_ids = set()
    with db:
        for channel in channels:
            if not isinstance(channel, dict):
                raise CollectorError("Canal fora do formato documentado.")
            cid = channel.get("id")
            kind = channel.get("_t")
            if isinstance(cid, str) and kind in WHATSAPP_TYPES:
                whatsapp_ids.add(cid)
                db.execute("""INSERT INTO channels VALUES (?, ?, ?, ?)
                    ON CONFLICT(organization_id, id) DO UPDATE SET kind=excluded.kind, raw_json=excluded.raw_json""",
                    (org_id, cid, kind, json_text(channel)))
    if not whatsapp_ids:
        raise CollectorError("Nenhum canal WhatsApp reconhecido na resposta da API.")
    # Freeze chat discovery at the export's upper timestamp. If resuming, keep the
    # saved offset and timestamp rather than shifting the result window.
    discover(db, client, org_id, whatsapp_ids, refresh=is_new, cutoff_utc=run["until_utc"],
             tag_id=tag_id, export_run_id=run["id"], candidate_start_utc=run["from_utc"])
    with db:
        db.execute(f"""INSERT OR IGNORE INTO export_chat_progress
            (run_id, organization_id, chat_id, cursor_utc)
            SELECT ?, c.organization_id, c.id, ?
            FROM export_chat_candidates e JOIN chats c ON c.organization_id=? AND c.id=e.chat_id
            WHERE e.run_id=?""",
            (run["id"], iso_utc(parse_utc(run["until_utc"]) + OVERLAP), org_id, run["id"]))
    total = db.execute("SELECT COUNT(*) FROM export_chat_progress WHERE run_id=?", (run["id"],)).fetchone()[0]
    # Materializa de novo os chats já concluídos no caso de retomada após uma
    # interrupção durante a gravação local dos arquivos.
    completed = db.execute("SELECT chat_id FROM export_chat_progress WHERE run_id=? AND complete=1 ORDER BY chat_id",
                           (run["id"],)).fetchall()
    for item in completed:
        write_export_chat(db, run, item["chat_id"], output_dir)
    while True:
        state = db.execute("""SELECT chat_id FROM export_chat_progress
            WHERE run_id=? AND complete=0 ORDER BY chat_id LIMIT 1""", (run["id"],)).fetchone()
        if state is None:
            break
        count, complete = sync_export_chat(db, client, run, state["chat_id"])
        if complete:
            write_export_chat(db, run, state["chat_id"], output_dir)
        done = db.execute("SELECT COUNT(*) FROM export_chat_progress WHERE run_id=? AND complete=1",
                          (run["id"],)).fetchone()[0]
        if done % 10 == 0 or done == total or not complete:
            messages = db.execute("SELECT COUNT(*) FROM export_messages WHERE run_id=?", (run["id"],)).fetchone()[0]
            print(f"Exportação: {done}/{total} conversas prontas; {messages} mensagens salvas.", flush=True)
    run = db.execute("SELECT * FROM export_runs WHERE id=?", (run["id"],)).fetchone()
    file_count, message_count, limited = finish_export(db, run, output_dir)
    print(f"Arquivos TXT gravados em: {output_dir} ({file_count} arquivos).", flush=True)
    print(f"Mensagens exportadas: {message_count}; conversas exportadas: {total}; chats limitados pelo plano: {limited}.", flush=True)


def list_channels(client: TalkClient, org_id: str) -> list[dict]:
    channels = client.get("/v1/channels/", {"organizationId": org_id})
    if not isinstance(channels, list):
        raise CollectorError("Lista de canais fora do formato documentado.")
    return channels


def run_probe(client: TalkClient) -> None:
    me = client.get("/v1/members/me/")
    if not isinstance(me, dict):
        raise CollectorError("Resposta de /members/me fora do formato documentado.")
    organizations = me.get("organizations")
    if not isinstance(organizations, list):
        raise CollectorError("Resposta de /members/me sem organizations.")
    if not organizations:
        raise CollectorError("O token não retornou organizações acessíveis.")
    print("Organizações disponíveis:")
    for organization in organizations:
        if isinstance(organization, dict):
            print(f"  {organization.get('id', '?')}  {organization.get('name', '')}")


def run_sync(db: sqlite3.Connection, client: TalkClient, org_id: str) -> None:
    channels = list_channels(client, org_id)
    whatsapp_ids = set()
    with db:
        for channel in channels:
            if not isinstance(channel, dict):
                raise CollectorError("Canal fora do formato documentado.")
            cid = channel.get("id")
            kind = channel.get("_t")
            if isinstance(cid, str) and kind in WHATSAPP_TYPES:
                whatsapp_ids.add(cid)
                db.execute("""INSERT INTO channels VALUES (?, ?, ?, ?)
                    ON CONFLICT(organization_id, id) DO UPDATE SET kind=excluded.kind, raw_json=excluded.raw_json""",
                    (org_id, cid, kind, json_text(channel)))
    if not whatsapp_ids:
        kinds = sorted({str(c.get("_t")) for c in channels if isinstance(c, dict)})
        raise CollectorError("Nenhum canal WhatsApp reconhecido. Tipos encontrados: " + ", ".join(kinds))
    print(f"{len(whatsapp_ids)} canal(is) WhatsApp identificado(s).")
    state = db.execute("SELECT * FROM discovery WHERE organization_id=?", (org_id,)).fetchone()
    refresh = False
    if state is not None and state["complete"]:
        pending = db.execute("""SELECT COUNT(*) FROM chats c LEFT JOIN chat_sync s
            ON s.organization_id=c.organization_id AND s.chat_id=c.id
            WHERE c.organization_id=? AND c.channel_id IN ({})
              AND (s.last_checked_at IS NULL OR s.last_checked_at < ?)""".format(",".join("?" for _ in whatsapp_ids)),
            (org_id, *sorted(whatsapp_ids), state["cutoff_utc"])).fetchone()[0]
        refresh = pending == 0
    discover(db, client, org_id, whatsapp_ids, refresh=refresh)
    chats = db.execute("""SELECT c.id FROM chats c LEFT JOIN chat_sync s
        ON s.organization_id=c.organization_id AND s.chat_id=c.id
        WHERE c.organization_id=? AND c.channel_id IN ({})
        ORDER BY COALESCE(s.last_checked_at, '') ASC, c.id ASC""".format(",".join("?" for _ in whatsapp_ids)),
        (org_id, *sorted(whatsapp_ids))).fetchall()
    for index, chat in enumerate(chats, 1):
        saved, complete = sync_one_chat(db, client, org_id, chat["id"])
        print(f"Chat {index}/{len(chats)}: {saved} mensagens processadas; histórico "
              f"{'concluído' if complete else 'em andamento'}.")


def run_status(db: sqlite3.Connection, org_id: str) -> None:
    for label, query in (
        ("Chats WhatsApp", "SELECT COUNT(*) FROM chats WHERE organization_id=?"),
        ("Mensagens únicas", "SELECT COUNT(*) FROM messages WHERE organization_id=?"),
        ("Históricos disponíveis percorridos", "SELECT COUNT(*) FROM chat_sync WHERE organization_id=? AND backfill_complete=1"),
        ("Históricos ainda pendentes", "SELECT COUNT(*) FROM chats c LEFT JOIN chat_sync s ON s.organization_id=c.organization_id AND s.chat_id=c.id WHERE c.organization_id=? AND COALESCE(s.backfill_complete, 0)=0"),
        ("Chats com páginas novas pendentes", "SELECT COUNT(*) FROM chat_sync WHERE organization_id=? AND forward_pending=1"),
        ("Históricos limitados pelo plano", "SELECT COUNT(*) FROM chat_sync WHERE organization_id=? AND history_limited=1"),
    ):
        print(f"{label}: {db.execute(query, (org_id,)).fetchone()[0]}")
    row = db.execute("SELECT next_skip, complete FROM discovery WHERE organization_id=?", (org_id,)).fetchone()
    if row:
        print(f"Descoberta: {row['next_skip']} examinados; {'concluída' if row['complete'] else 'em andamento'}.")


def main(argv: list[str] | None = None) -> int:
    require_legacy_mode()
    parser = argparse.ArgumentParser(description="Coletor de leitura das conversas WhatsApp do Umbler Talk")
    parser.add_argument("command", choices=("probe", "sync", "status", "export"))
    parser.add_argument("--org-id", default=os.environ.get("UTALK_ORGANIZATION_ID"))
    parser.add_argument("--db", type=Path, default=Path(__file__).resolve().parent / "data" / "utalk.sqlite3")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--days", type=int, default=0,
                        help="Janela da exportação: 0 (padrão) percorre todo o histórico disponível; 1 a 90 limita em dias")
    parser.add_argument("--from-utc", help="Início UTC inclusivo de uma janela exata (exige --until-utc)")
    parser.add_argument("--until-utc", help="Fim UTC inclusivo de uma janela exata (exige --from-utc)")
    parser.add_argument("--tag", default="Google ADS", help="Etiqueta exata das conversas a exportar")
    parser.add_argument("--all-whatsapp", action="store_true",
                        help="Exporta todos os chats WhatsApp com atividade possível na janela, sem filtro de etiqueta")
    parser.add_argument("--rescan", action="store_true", help="Recomeça a leitura do histórico da organização, preservando os dados locais")
    parser.add_argument("--interval", type=float, default=3.0, help="Segundos mínimos entre tentativas HTTP (exportação exige pelo menos 2)")
    parser.add_argument("--max-requests", type=int, default=150, help="Orçamento máximo de tentativas HTTP por execução")
    args = parser.parse_args(argv)
    try:
        if args.rescan and args.command != "sync":
            raise CollectorError("--rescan só pode ser usado com sync.")
        if args.command == "export" and not 0 <= args.days <= 90:
            raise CollectorError("--days deve ser 0 (todo o histórico disponível) ou estar entre 1 e 90.")
        if args.command != "export" and (args.from_utc or args.until_utc):
            raise CollectorError("--from-utc e --until-utc só podem ser usados com export.")
        if args.command == "export" and bool(args.from_utc) != bool(args.until_utc):
            raise CollectorError("Informe --from-utc e --until-utc juntos.")
        if args.command == "export" and args.from_utc:
            start = parse_utc(args.from_utc)
            end = parse_utc(args.until_utc)
            if start >= end:
                raise CollectorError("O início da exportação deve ser anterior ao fim.")
        if args.command == "export" and args.interval < 2.0:
            raise CollectorError("A exportação exige --interval de pelo menos 2 segundos.")
        if args.command == "export" and not args.all_whatsapp and not args.tag.strip():
            raise CollectorError("Informe o nome da etiqueta para exportar.")
        if args.all_whatsapp and args.command != "export":
            raise CollectorError("--all-whatsapp só pode ser usado com export.")
        args.db = args.db.expanduser().resolve()
        args.output_dir = args.output_dir.expanduser().resolve()
        if args.command == "status":
            if not args.org_id:
                raise CollectorError("Informe --org-id ou UTALK_ORGANIZATION_ID.")
            if not args.db.exists():
                raise CollectorError("Banco local ainda não existe.")
            with closing(connect_db(args.db)) as db:
                run_status(db, valid_id(args.org_id, "ID da organização"))
            return 0
        if args.command in ("sync", "export") and not args.org_id:
            raise CollectorError("Informe --org-id ou UTALK_ORGANIZATION_ID.")
        org_id = valid_id(args.org_id, "ID da organização") if args.org_id else None
        state_path = runtime_state_path()
        # All collector processes under this OS user share the same gate and cooldown,
        # including probe and executions pointed at different databases.
        with single_process_lock(state_path):
            client = TalkClient(os.environ.get("UTALK_API_TOKEN", ""), interval=args.interval,
                                max_requests=args.max_requests, state_path=state_path)
            if args.command == "probe":
                run_probe(client)
                return 0
            with single_process_lock(args.db), closing(connect_db(args.db)) as db:
                if args.command == "export":
                    try:
                        run_tag_export(db, client, org_id, args.days,
                                       None if args.all_whatsapp else args.tag, args.output_dir,
                                       from_utc=args.from_utc, until_utc=args.until_utc)
                    except BudgetExhausted:
                        print("Orçamento desta execução atingido. Progresso salvo; execute export novamente para retomar.", flush=True)
                    print(f"Tentativas HTTP nesta execução: {client.attempts}/{client.max_requests}.", flush=True)
                    return 0
                if args.rescan:
                    with db:
                        db.execute("DELETE FROM discovery WHERE organization_id=?", (org_id,))
                        db.execute("DELETE FROM chat_sync WHERE organization_id=?", (org_id,))
                    print("Nova leitura completa iniciada; mensagens já salvas serão preservadas.")
                try:
                    run_sync(db, client, org_id)
                except BudgetExhausted:
                    print("Orçamento de requisições atingido. Progresso salvo; execute sync novamente.")
                print(f"Tentativas HTTP nesta execução: {client.attempts}/{client.max_requests}.")
                run_status(db, org_id)
        return 0
    except KeyboardInterrupt:
        next_command = "export" if "args" in locals() and args.command == "export" else "sync"
        print(f"\nColeta interrompida. Páginas confirmadas foram preservadas; execute {next_command} para retomar.", file=sys.stderr)
        return 130
    except CollectorError as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        return 1
    except (OSError, sqlite3.Error):
        print("Erro local ao abrir ou gravar arquivos. Verifique o caminho, as permissões e o espaço em disco.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
