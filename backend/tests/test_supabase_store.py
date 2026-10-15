"""Storage protocol tests; these do not claim a live Supabase deployment."""
import json

import httpx
import pytest

from forgepad.storage import StorageConflict
from forgepad.supabase_store import SupabaseStore


def store_for(monkeypatch, handler):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key")
    store = SupabaseStore()
    store.client.close()
    store.client = httpx.Client(transport=httpx.MockTransport(handler), headers={"apikey":"server-only-test-key"})
    return store


def test_question_rehydrates_separate_solution(monkeypatch):
    def handle(request):
        assert request.headers["apikey"] == "server-only-test-key"
        data = {"id":"sample","version":1,"payload": {"id":"sample","version":1}}
        if request.url.path.endswith("forgepad_solutions"):
            data["payload"] = {"reference_solution":{"main.c":"PRIVATE"}}
        return httpx.Response(200, json=[data])
    store = store_for(monkeypatch, handle)
    assert store.question("sample")["reference_solution"]["main.c"] == "PRIVATE"


def test_interview_updates_reject_stale_revision(monkeypatch):
    def handle(request):
        assert request.method == "PATCH" and request.url.params["revision"] == "eq.3"
        body = json.loads(request.content)
        assert body["revision"] == 4 and "_revision" not in body["payload"]
        return httpx.Response(200, json=[])
    store = store_for(monkeypatch, handle)
    with pytest.raises(StorageConflict):
        store.save_record("interviews", {"id":"session", "_revision":3})


def test_export_pagination_does_not_drop_older_records(monkeypatch):
    def handle(request):
        offset = int(request.url.params["offset"])
        size = 500 if offset == 0 else 2
        return httpx.Response(200, json=[{"payload":{"id":str(offset+i)}} for i in range(size)])
    store = store_for(monkeypatch, handle)
    assert len(store.records("attempts")) == 502
