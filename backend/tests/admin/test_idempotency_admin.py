"""SPEC-011 11.2 / 11.10: idempotency on admin mutations, DTO strictness, rate limits, request id."""
import time


EX_BODY = {"title": "Idem", "slug": "idem-same", "type": "STRENGTH", "description": "Описание"}


def test_idempotency_key_required_on_admin_mutations(actors):
    r = actors["admin_client"].post("/api/v1/admin/exercises", json=EX_BODY, headers=actors["headers"]["content_manager"])
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "MISSING_IDEMPOTENCY_KEY"


def test_idempotency_same_body_same_result(actors):
    h = {**actors["headers"]["content_manager"], "Idempotency-Key": "t-idem-1"}
    body = EX_BODY
    r1 = actors["admin_client"].post("/api/v1/admin/exercises", json=body, headers=h)
    assert r1.status_code == 201
    r2 = actors["admin_client"].post("/api/v1/admin/exercises", json=body, headers=h)
    assert r2.status_code == 201
    assert r2.json()["data"]["id"] == r1.json()["data"]["id"]


def test_idempotency_different_body_409(actors):
    h = {**actors["headers"]["content_manager"], "Idempotency-Key": "t-idem-2"}
    body_a = dict(EX_BODY, title="A", slug="idem-diff")
    body_b = dict(EX_BODY, title="B", slug="idem-diff")
    r = actors["admin_client"].post("/api/v1/admin/exercises", json=body_a, headers=h)
    assert r.status_code == 201
    r = actors["admin_client"].post("/api/v1/admin/exercises", json=body_b, headers=h)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_legacy_client_endpoints_still_work_with_key(actors):
    """A key on non-admin endpoints is accepted (legacy behavior preserved)."""
    r = actors["admin_client"].post(
        "/api/v1/auth/register",
        json={"email": f"idem{int(time.time())}@fittrack.dev", "password": "Passw0rd!", "first_name": "I", "last_name": "K"},
        headers={"Idempotency-Key": "t-legacy-1"},
    )
    assert r.status_code in (200, 201)


def test_unknown_query_param_rejected(actors):
    r = actors["admin_client"].get("/api/v1/admin/users?perPage=5", headers=actors["headers"]["admin"])
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "UNKNOWN_QUERY_PARAMETER"


def test_unknown_dto_field_rejected(actors):
    r = actors["admin_client"].post(
        "/api/v1/admin/exercises",
        json=dict(EX_BODY, slug="dto-strict", role="super_admin"),
        headers={**actors["headers"]["content_manager"], "Idempotency-Key": "t-dto-1"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_request_id_on_every_response(actors):
    r = actors["admin_client"].get("/api/v1/admin/me", headers=actors["headers"]["admin"])
    assert r.headers.get("X-Request-Id")
    r = actors["admin_client"].get("/api/v1/admin/users?bad=1", headers=actors["headers"]["admin"])
    assert r.headers.get("X-Request-Id")
    assert r.json()["error"]["requestId"] == r.headers["X-Request-Id"]


def test_error_shape_and_no_stack_leak(actors):
    r = actors["admin_client"].get("/api/v1/admin/users/00000000-0000-4000-8000-000000000000", headers=actors["headers"]["admin"])
    assert r.status_code == 404
    err = r.json()["error"]
    assert err["code"] == "NOT_FOUND"
    assert "Traceback" not in r.text
    assert "sqlite" not in r.text.lower()


def test_admin_rate_limit_429(actors, monkeypatch, db_session):
    from app.config import get_settings
    from tests.admin.conftest import make_user

    settings = get_settings()
    monkeypatch.setattr(settings, "ADMIN_RATE_LIMIT_REQUESTS", 3, raising=False)
    fresh = make_user(db_session, "admin", email=f"rl{int(time.time())}@fittrack.dev")
    r = actors["admin_client"].post("/api/v1/admin/auth/login", json={"email": fresh.email, "password": "Passw0rd!"})
    assert r.status_code == 200
    token = r.json()["data"]["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    # login is excluded from the per-admin limit; GET /me is not
    for _ in range(3):
        assert actors["admin_client"].get("/api/v1/admin/me", headers=h).status_code == 200
    r = actors["admin_client"].get("/api/v1/admin/me", headers=h)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "RATE_LIMITED"
