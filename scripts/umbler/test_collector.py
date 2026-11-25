import io
import json
from datetime import timedelta
from email.utils import format_datetime
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

import collector as reader


class FakeTalkClient:
    def __init__(self, chats, messages, history_limited=False):
        self.chats = chats
        self.messages = messages
        self.history_limited = history_limited
        self.calls = []

    def get(self, path, params=None):
        self.calls.append((path, params))
        if path == "/v1/channels/":
            return [
                {"id": "WA123", "_t": "OrganizationCloudAPIWhatsappChannelReferenceModel"},
                {"id": "IG123", "_t": "OrganizationGupshupInstagramChannelReferenceModel"},
            ]
        if path == "/v1/chats/":
            start = params["Skip"]
            take = params["Take"]
            # GetSliceOnly need not calculate a total count.
            return {"items": self.chats[start:start + take], "page": {"totalItems": 0}}
        if path.endswith("/relative-messages/"):
            chat_id = path.split("/")[3]
            cursor = reader.parse_utc(params["FromEventUTC"])
            messages = self.messages[chat_id]
            if params["Direction"] == "TakeBefore":
                selected = sorted(
                    (m for m in messages if reader.parse_utc(m["eventAtUTC"]) < cursor),
                    key=lambda m: m["eventAtUTC"], reverse=True)
            else:
                selected = sorted(
                    (m for m in messages if reader.parse_utc(m["eventAtUTC"]) > cursor),
                    key=lambda m: m["eventAtUTC"])
            return {"messages": selected[:params["Take"]],
                    "hasMessagesBeforeAllowedOrganizationPlan": self.history_limited}
        raise AssertionError(path)


class ReaderTests(unittest.TestCase):
    def test_tagged_export_skips_historical_candidates_before_message_calls(self):
        start = "2026-10-19T14:33:52.953798Z"
        tag = {"id": "TAG123", "name": "Google"}
        chats = [
            {"id": "ACTIVE", "channel": {"id": "WA123"}, "tags": [tag],
             "contact": {"tags": []},
             "lastMessage": {"eventAtUTC": "2026-10-25T12:00:00.000Z"}},
            {"id": "OLD", "channel": {"id": "WA123"}, "tags": [tag],
             "contact": {"tags": []},
             "lastMessage": {"eventAtUTC": "2026-10-18T12:00:00.000Z"}},
        ]
        client = FakeTalkClient(chats, {})
        with tempfile.TemporaryDirectory() as directory:
            db = reader.connect_db(Path(directory) / "test.sqlite3")
            try:
                run, _ = reader.export_run_for(
                    db, "ORG123", 7, "TAG123", "Google",
                    from_utc=start, until_utc="2026-10-26T13:37:08.262944Z")
                reader.discover(
                    db, client, "ORG123", {"WA123"}, refresh=True,
                    cutoff_utc=run["until_utc"], tag_id="TAG123",
                    export_run_id=run["id"], candidate_start_utc=run["from_utc"])
                candidates = [row[0] for row in db.execute(
                    "SELECT chat_id FROM export_chat_candidates ORDER BY chat_id")]
                self.assertEqual(candidates, ["ACTIVE"])
            finally:
                db.close()

    def test_unfiltered_export_discovers_only_whatsapp_activity_candidates(self):
        start = "2026-10-01T03:00:00.000000Z"
        chats = [
            {"id": "ACTIVE", "channel": {"id": "WA123"},
             "lastMessage": {"eventAtUTC": "2026-10-05T12:00:00.000Z"}},
            {"id": "OLD", "channel": {"id": "WA123"},
             "lastMessage": {"eventAtUTC": "2026-09-30T12:00:00.000Z"}},
            {"id": "OTHER", "channel": {"id": "IG123"},
             "lastMessage": {"eventAtUTC": "2026-10-05T12:00:00.000Z"}},
        ]
        client = FakeTalkClient(chats, {})
        with tempfile.TemporaryDirectory() as directory:
            db = reader.connect_db(Path(directory) / "test.sqlite3")
            try:
                run, _ = reader.export_run_for(
                    db, "ORG123", 23, None, "Todos os canais WhatsApp",
                    from_utc=start, until_utc="2026-10-24T02:59:59.999999Z")
                reader.discover(
                    db, client, "ORG123", {"WA123"}, refresh=True,
                    cutoff_utc=run["until_utc"], export_run_id=run["id"],
                    candidate_start_utc=run["from_utc"])
                candidates = [row[0] for row in db.execute(
                    "SELECT chat_id FROM export_chat_candidates ORDER BY chat_id")]
                self.assertEqual(candidates, ["ACTIVE"])
                chat_calls = [params for path, params in client.calls if path == "/v1/chats/"]
                self.assertTrue(chat_calls)
                self.assertTrue(all("Tags.Values" not in params for params in chat_calls))
                self.assertTrue(all(params["ChatOrderBy"] == "LastMessage" for params in chat_calls))
                self.assertTrue(all(params["Order"] == "Desc" for params in chat_calls))
            finally:
                db.close()

    def test_exact_export_window_is_preserved_for_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            db = reader.connect_db(Path(directory) / "test.sqlite3")
            first, is_new = reader.export_run_for(
                db, "ORG123", 7, "TAG123", "Google ADS",
                from_utc="2026-10-12T17:23:39.243688Z",
                until_utc="2026-10-19T15:00:00Z",
            )
            resumed, resumed_is_new = reader.export_run_for(
                db, "ORG123", 7, "TAG123", "Google ADS",
                from_utc="2026-10-12T17:23:39.243688Z",
                until_utc="2026-10-19T15:00:00Z",
            )
            self.assertTrue(is_new)
            self.assertFalse(resumed_is_new)
            self.assertEqual(first["id"], resumed["id"])
            self.assertEqual(first["from_utc"], "2026-10-12T17:23:39.243688Z")
            self.assertEqual(first["until_utc"], "2026-10-19T15:00:00.000000Z")
            db.close()

    def test_retry_after_accepts_http_date(self):
        now = reader.utc_now().replace(microsecond=0)
        with patch.object(reader, "utc_now", return_value=now):
            self.assertEqual(reader.TalkClient.retry_after({
                "Retry-After": format_datetime(now + timedelta(seconds=30), usegmt=True)
            }), 30.0)

    def test_saturated_timestamp_stops_without_claiming_complete_history(self):
        timestamp = reader.iso_utc(reader.utc_now() - timedelta(seconds=1))
        client = FakeTalkClient([], {"CHAT1": [
            {"id": f"M{i:03}", "eventAtUTC": timestamp} for i in range(101)
        ]})
        with tempfile.TemporaryDirectory() as directory:
            db = reader.connect_db(Path(directory) / "test.sqlite3")
            try:
                with self.assertRaises(reader.CollectorError):
                    reader.sync_one_chat(db, client, "ORG123", "CHAT1")
                self.assertEqual(db.execute("SELECT backfill_complete FROM chat_sync").fetchone()[0], 0)
                self.assertEqual(len(client.calls), 2)
            finally:
                db.close()

    def test_cooldown_survives_restart_and_does_not_store_token(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "http_state.json"
            first = reader.TalkClient("secret", state_path=state, clock=lambda: 1000.0,
                                      wall_clock=lambda: 1000.0)
            first.opener = Mock()
            first.opener.open.side_effect = HTTPError("https://example.invalid", 429, "rate limited",
                                                      {"Retry-After": "600"}, io.BytesIO())
            with self.assertRaises(reader.CollectorError):
                first.get("/v1/members/me/")
            saved = state.read_text(encoding="utf-8")
            self.assertNotIn("secret", saved)
            self.assertEqual(json.loads(saved)["not_before_epoch"], 1600.0)
            second = reader.TalkClient("secret", state_path=state, clock=lambda: 1001.0,
                                       wall_clock=lambda: 1001.0)
            second.opener = Mock()
            with self.assertRaises(reader.CollectorError):
                second.get("/v1/members/me/")
            second.opener.open.assert_not_called()

    def test_auth_failure_stops_without_retry_and_token_is_normalized(self):
        client = reader.TalkClient("  Bearer secret  ")
        client.opener = Mock()
        client.opener.open.side_effect = HTTPError("https://example.invalid", 401, "no access", {}, io.BytesIO())
        with self.assertRaises(reader.CollectorError):
            client.get("/v1/members/me/")
        self.assertEqual(client.attempts, 1)
        request = client.opener.open.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(request.get_method(), "GET")

    def test_request_budget_counts_retries(self):
        now = [1000.0]
        client = reader.TalkClient("secret", max_requests=2, clock=lambda: now[0],
                                   sleeper=lambda seconds: now.__setitem__(0, now[0] + seconds))
        client.opener = Mock()
        client.opener.open.side_effect = [
            HTTPError("https://example.invalid", 503, "unavailable", {}, io.BytesIO()) for _ in range(2)
        ]
        with self.assertRaises(reader.BudgetExhausted):
            client.get("/v1/members/me/")
        self.assertEqual(client.opener.open.call_count, 2)

    def test_api_redirect_is_blocked(self):
        with self.assertRaises(reader.CollectorError):
            reader.NoRedirects().redirect_request(None, None, 302, "redirect", {}, "https://another.example/")

    def test_global_lock_also_blocks_different_database(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "http_state.json"
            with patch.dict(reader.os.environ, {"APP_MODE": "local"}), \
                 patch.object(reader, "runtime_state_path", return_value=state), \
                 patch.object(reader.TalkClient, "get") as get:
                with reader.single_process_lock(state):
                    result = reader.main(["probe", "--db", str(Path(directory) / "other.sqlite3")])
                self.assertEqual(result, 1)
                get.assert_not_called()

    def test_mongo_mode_blocks_legacy_collector_before_provider_access(self):
        with patch.dict(reader.os.environ, {"APP_MODE": "mongo"}), \
             patch.object(reader.TalkClient, "get") as get:
            with self.assertRaises(SystemExit):
                reader.main(["probe"])
            get.assert_not_called()

    def test_unchanged_chat_page_stops_without_advancing_offset(self):
        chats = [{"id": "CHAT1", "channel": {"id": "WA123"}}]
        client = Mock()
        client.get.return_value = {"items": chats, "page": {"totalItems": 0}}
        with tempfile.TemporaryDirectory() as directory:
            db = reader.connect_db(Path(directory) / "test.sqlite3")
            try:
                with self.assertRaises(reader.CollectorError):
                    reader.discover(db, client, "ORG123", {"WA123"})
                self.assertEqual(client.get.call_count, 2)
                self.assertEqual(db.execute("SELECT next_skip FROM discovery").fetchone()[0], 1)
            finally:
                db.close()

    def test_message_page_is_atomic_when_payload_is_invalid(self):
        timestamp = reader.iso_utc(reader.utc_now() - timedelta(seconds=1))
        client = Mock()
        client.get.return_value = {"messages": [
            {"id": "M1", "eventAtUTC": timestamp},
            {"id": "M2", "eventAtUTC": "invalid-date"},
        ]}
        with tempfile.TemporaryDirectory() as directory:
            db = reader.connect_db(Path(directory) / "test.sqlite3")
            try:
                with self.assertRaises(reader.CollectorError):
                    reader.sync_one_chat(db, client, "ORG123", "CHAT1")
                self.assertEqual(db.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT backfill_complete FROM chat_sync").fetchone()[0], 0)
            finally:
                db.close()

    def test_forward_backlog_is_visible_and_resumes(self):
        now = reader.utc_now()
        client = FakeTalkClient([], {"CHAT1": []})
        with tempfile.TemporaryDirectory() as directory:
            db = reader.connect_db(Path(directory) / "test.sqlite3")
            try:
                reader.sync_one_chat(db, client, "ORG123", "CHAT1")
                client.messages["CHAT1"] = [
                    {"id": f"M{i:03}", "eventAtUTC": reader.iso_utc(now + timedelta(seconds=i + 1))}
                    for i in range(250)
                ]
                reader.sync_one_chat(db, client, "ORG123", "CHAT1")
                self.assertEqual(db.execute("SELECT forward_pending FROM chat_sync").fetchone()[0], 1)
                reader.sync_one_chat(db, client, "ORG123", "CHAT1")
                self.assertEqual(db.execute("SELECT forward_pending FROM chat_sync").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 250)
            finally:
                db.close()

    def test_full_history_incremental_and_whatsapp_filter(self):
        now = reader.utc_now()
        original = [
            {"id": f"M{i:03}", "eventAtUTC": reader.iso_utc(now - timedelta(seconds=200 - i // 7)),
             "content": f"mensagem {i}"}
            for i in range(120)
        ]
        client = FakeTalkClient([
            {"id": "CHAT1", "channel": {"id": "WA123"}, "lastMessage": original[-1]},
            {"id": "CHAT2", "channel": {"id": "IG123"}},
        ], {"CHAT1": original}, history_limited=True)
        with tempfile.TemporaryDirectory() as directory:
            db = reader.connect_db(Path(directory) / "test.sqlite3")
            try:
                reader.run_sync(db, client, "ORG123")
                self.assertEqual(db.execute("SELECT COUNT(*) FROM chats").fetchone()[0], 1)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 120)
                self.assertEqual(db.execute("SELECT backfill_complete FROM chat_sync").fetchone()[0], 1)
                self.assertEqual(db.execute("SELECT history_limited FROM chat_sync").fetchone()[0], 1)
                new = {"id": "M120", "eventAtUTC": reader.iso_utc(now + timedelta(seconds=10)),
                       "content": "nova mensagem"}
                client.messages["CHAT1"].append(new)
                reader.run_sync(db, client, "ORG123")
                self.assertEqual(db.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 121)
                self.assertTrue(all(path in ("/v1/channels/", "/v1/chats/") or
                                    path.endswith("/relative-messages/") for path, _ in client.calls))
            finally:
                db.close()

    def test_discovery_resumes_from_saved_offset(self):
        chats = [{"id": f"CHAT{i:03}", "channel": {"id": "WA123"}} for i in range(120)]
        client = FakeTalkClient(chats, {})
        with tempfile.TemporaryDirectory() as directory:
            db = reader.connect_db(Path(directory) / "test.sqlite3")
            try:
                class LimitedClient:
                    def __init__(self):
                        self.calls = 0

                    def get(self, path, params):
                        self.calls += 1
                        if self.calls > 1:
                            raise reader.BudgetExhausted("budget")
                        return client.get(path, params)

                with self.assertRaises(reader.BudgetExhausted):
                    reader.discover(db, LimitedClient(), "ORG123", {"WA123"})
                row = db.execute("SELECT next_skip, complete FROM discovery").fetchone()
                self.assertEqual((row[0], row[1]), (50, 0))
                reader.discover(db, client, "ORG123", {"WA123"})
                self.assertEqual(db.execute("SELECT COUNT(*) FROM chats").fetchone()[0], 120)
                self.assertEqual(db.execute("SELECT complete FROM discovery").fetchone()[0], 1)
                self.assertEqual([p["Skip"] for path, p in client.calls if path == "/v1/chats/"],
                                 [0, 50, 100, 120])
            finally:
                db.close()

    def test_http_429_respects_retry_after_and_remains_get(self):
        current = [0.0]
        slept = []

        def sleep(seconds):
            slept.append(seconds)
            current[0] += seconds

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self, *_):
                return b"{}"

        class Opener:
            attempts = 0

            def open(self, request, timeout):
                self.attempts += 1
                self_method = request.get_method()
                if self_method != "GET":
                    raise AssertionError(self_method)
                if self.attempts == 1:
                    raise HTTPError(request.full_url, 429, "rate limited", {"Retry-After": "3"}, io.BytesIO())
                return Response()

        client = reader.TalkClient("secret", sleeper=sleep, clock=lambda: current[0])
        client.opener = Opener()
        self.assertEqual(client.get("/v1/members/me/"), {})
        self.assertEqual(client.attempts, 2)
        self.assertGreaterEqual(sum(slept), 3)
        with self.assertRaises(reader.CollectorError):
            client.get("/v1/messages/", {})

    def test_second_local_collector_cannot_take_same_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.sqlite3"
            with reader.single_process_lock(path):
                with self.assertRaises(reader.CollectorError):
                    with reader.single_process_lock(path):
                        pass
            with reader.single_process_lock(path):
                pass


if __name__ == "__main__":
    unittest.main()
