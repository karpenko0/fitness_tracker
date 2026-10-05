"""SPEC-011 11.6: content workflows, pre-publish checks, versioning, media."""
import base64

EX_BODY_DEFAULTS = {
    "type": "STRENGTH",
    "description": "Тестовое описание упражнения",
    "localizations": {"ru": {"description": "Тестовое описание"}},
}


def _png():
    return base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()


def _ex(actors, db_session=None, **kw):
    from app.admin.models_content import Exercise

    e = Exercise(**{k: v for k, v in kw.items() if not k.startswith("_")})
    db_session.add(e)
    db_session.commit()
    db_session.refresh(e)
    return e


def _create_ex(actors, slug, **kw):
    body = {"title": f"Exercise {slug}", "slug": slug}
    body.update(EX_BODY_DEFAULTS)
    body.update(kw)
    h = {**actors["headers"]["content_manager"], "Idempotency-Key": f"t-ex-{slug}-1"}
    r = actors["admin_client"].post("/api/v1/admin/exercises", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def test_exercise_create_and_duplicate_slug(actors):
    _create_ex(actors, "bench-press")
    r = actors["admin_client"].post(
        "/api/v1/admin/exercises",
        json=dict(EX_BODY_DEFAULTS, title="Bench", slug="bench-press"),
        headers={**actors["headers"]["content_manager"], "Idempotency-Key": "t-dup-1"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "bench-press" in str(r.json()["error"]["details"])


def test_cycle_detection(actors):
    a = _create_ex(actors, "cycle-a")
    b = _create_ex(actors, "cycle-b")
    c = _create_ex(actors, "cycle-c")
    h = actors["headers"]["content_manager"]
    r = actors["admin_client"].post(f"/api/v1/admin/exercises/{a}/alternatives", json={"alternative_exercise_id": b}, headers={**h, "Idempotency-Key": "t-cy-1"})
    assert r.status_code == 201
    r = actors["admin_client"].post(f"/api/v1/admin/exercises/{b}/alternatives", json={"alternative_exercise_id": c}, headers={**h, "Idempotency-Key": "t-cy-2"})
    assert r.status_code == 201
    r = actors["admin_client"].post(f"/api/v1/admin/exercises/{c}/alternatives", json={"alternative_exercise_id": a}, headers={**h, "Idempotency-Key": "t-cy-3"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "CYCLICAL_ALTERNATIVE"


def test_published_exercise_is_locked(actors):
    e = _create_ex(actors, "locked-one")
    h = actors["headers"]["content_manager"]
    r = actors["admin_client"].post(f"/api/v1/admin/exercises/{e}/publish", json={"confirm": True}, headers={**h, "Idempotency-Key": "t-pub-1"})
    assert r.status_code == 200
    r = actors["admin_client"].patch(f"/api/v1/admin/exercises/{e}", json={"description": "new"}, headers={**h, "Idempotency-Key": "t-pub-2"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "PUBLISHED_LOCKED"


def test_media_validates_mime_magic_size(actors):
    h = actors["headers"]["content_manager"]
    # wrong magic bytes for declared MIME
    bad = base64.b64encode(b"\x00\x00\x00\x18ftypmp42" + b"0" * 32).decode()
    r = actors["admin_client"].post(
        "/api/v1/admin/media",
        json={"filename": "bad.png", "kind": "IMAGE", "mime_type": "image/png", "content_base64": bad},
        headers={**h, "Idempotency-Key": "t-md-1"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "MEDIA_REJECTED"
    # oversized (limit is 10 MB for images)
    big = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * (11 * 1024 * 1024)).decode()
    r = actors["admin_client"].post(
        "/api/v1/admin/media",
        json={"filename": "big.png", "kind": "IMAGE", "mime_type": "image/png", "content_base64": big},
        headers={**h, "Idempotency-Key": "t-md-2"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "MEDIA_REJECTED"
    assert "large" in r.json()["error"]["message"].lower() or "size" in r.json()["error"]["message"].lower()
    # disallowed MIME
    r = actors["admin_client"].post(
        "/api/v1/admin/media",
        json={"filename": "page.html", "kind": "IMAGE", "mime_type": "text/html", "content_base64": base64.b64encode(b"<html>").decode()},
        headers={**h, "Idempotency-Key": "t-md-3"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "MEDIA_REJECTED"


def test_media_delete_blocked_when_in_use(actors):
    h = actors["headers"]["content_manager"]
    r = actors["admin_client"].post(
        "/api/v1/admin/media",
        json={"filename": "squat.png", "kind": "IMAGE", "mime_type": "image/png", "content_base64": _png()},
        headers={**h, "Idempotency-Key": "t-mdu-1"},
    )
    assert r.status_code == 201
    mid = r.json()["data"]["id"]
    # exercise referencing the media, then publish it
    r = actors["admin_client"].post(
        "/api/v1/admin/exercises",
        json={"title": "Squat", "slug": "with-media", "media_ids": [mid], **EX_BODY_DEFAULTS},
        headers={**h, "Idempotency-Key": "t-mdu-2"},
    )
    assert r.status_code == 201, r.text
    ex = r.json()["data"]["id"]
    assert actors["admin_client"].post(f"/api/v1/admin/exercises/{ex}/publish", json={"confirm": True}, headers={**h, "Idempotency-Key": "t-mdu-3"}).status_code == 200
    r = actors["admin_client"].delete(f"/api/v1/admin/media/{mid}", headers={**h, "Idempotency-Key": "t-mdu-4"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "IN_USE_BY_PUBLISHED_CONTENT"


def _make_program(actors, slug, weeks, **kw):
    body = {
        "title": f"Program {slug}",
        "slug": slug,
        "description": "Тестовая программа",
        "goal": "STRENGTH",
        "level": "BEGINNER",
        "equipment": ["barbell"],
        "duration_minutes": 1600,
        "localizations": {"ru": {"description": "Тестовая программа"}},
        "weeks": weeks,
    }
    body.update(kw)
    r = actors["admin_client"].post("/api/v1/admin/programs", json=body, headers={**actors["headers"]["content_manager"], "Idempotency-Key": f"t-pr-{slug}-1"})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def test_program_full_workflow_and_rollback(actors):
    ex = _create_ex(actors, "prog-ex")
    weeks = [
        {
            "name": "Неделя 1",
            "workouts": [
                {"name": "Тренировка A", "exercises": [{"exercise_id": ex, "sets": 3, "reps": 10, "rest_seconds": 90, "weight": 40}]}
            ],
        }
    ]
    prog = _make_program(actors, "beginner-strength", weeks)
    h = actors["headers"]["content_manager"]
    assert actors["admin_client"].post(f"/api/v1/admin/programs/{prog}/submit-review", json={}, headers={**h, "Idempotency-Key": "t-wf-1"}).status_code == 200
    assert actors["admin_client"].post(f"/api/v1/admin/programs/{prog}/approve", json={}, headers={**h, "Idempotency-Key": "t-wf-2"}).status_code == 200
    r = actors["admin_client"].post(
        f"/api/v1/admin/programs/{prog}/publish",
        json={"version": 1, "confirm": True, "reason": "Первая публикация"},
        headers={**h, "Idempotency-Key": "t-wf-3"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["published_version"] == 1

    # invalid transition from PUBLISHED
    r = actors["admin_client"].post(f"/api/v1/admin/programs/{prog}/submit-review", json={}, headers={**h, "Idempotency-Key": "t-wf-4"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "INVALID_TRANSITION"

    # versions list
    r = actors["admin_client"].get(f"/api/v1/admin/programs/{prog}/versions", headers=h)
    assert r.json()["data"]["total"] >= 1

    # unpublish then rollback -> new version appears, program back to PUBLISHED
    assert actors["admin_client"].post(
        f"/api/v1/admin/programs/{prog}/unpublish", json={"confirm": True, "reason": "Ошибки в прогрессии"}, headers={**h, "Idempotency-Key": "t-wf-5"}
    ).status_code == 200
    r = actors["admin_client"].post(
        f"/api/v1/admin/programs/{prog}/rollback", json={"version": 1, "confirm": True}, headers={**h, "Idempotency-Key": "t-wf-6"}
    )
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["published_version"] == 2
    assert data["status"] == "PUBLISHED"


def test_pre_publish_checks_reject_invalid_program(actors, db_session):
    """All pre-publish checks run before IN_REVIEW (SPEC-011 6.6): invalid programs
    cannot enter review, and a DRAFT program cannot be published directly."""
    ex = _create_ex(actors, "pp-ex")
    weeks = [
        {
            "name": "W",
            "workouts": [
                {"name": "T", "exercises": [{"exercise_id": ex, "sets": 0, "reps": -5}]},
            ],
        },
        {
            "name": "Ghost",
            "workouts": [
                {"name": "G", "exercises": [{"exercise_id": "11111111-1111-1111-1111-111111111111", "sets": 3, "reps": 10}]},
            ],
        },
    ]
    prog = _make_program(actors, "bad-program", weeks)
    h = actors["headers"]["content_manager"]
    # submit-review runs the full pre-publish validation
    r = actors["admin_client"].post(f"/api/v1/admin/programs/{prog}/submit-review", json={}, headers={**h, "Idempotency-Key": "t-bad-2"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    details = str(r.json()["error"].get("details"))
    assert "11111111" in details  # missing exercise reported
    assert "sets" in details  # invalid set count reported
    # the program is still DRAFT -> cannot be published directly
    r = actors["admin_client"].post(
        f"/api/v1/admin/programs/{prog}/publish", json={"version": 1, "confirm": True}, headers={**h, "Idempotency-Key": "t-bad-4"}
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "INVALID_TRANSITION"
    # atomicity: no version row was created
    from app.admin.models_content import ProgramVersion
    from uuid import UUID

    assert db_session.query(ProgramVersion).filter(ProgramVersion.program_id == UUID(prog)).count() == 0


def test_missing_exercise_rejected_on_submit_review(actors):
    weeks = [
        {
            "name": "W",
            "workouts": [
                {"name": "T", "exercises": [{"exercise_id": "11111111-1111-1111-1111-111111111111", "sets": 3, "reps": 10}]},
            ],
        }
    ]
    prog = _make_program(actors, "ghost-program", weeks)
    h = actors["headers"]["content_manager"]
    r = actors["admin_client"].post(f"/api/v1/admin/programs/{prog}/submit-review", json={}, headers={**h, "Idempotency-Key": "t-gh-1"})
    assert r.status_code == 400


def test_delete_used_exercise_blocked(actors):
    ex = _create_ex(actors, "used-ex")
    weeks = [
        {"name": "W", "workouts": [{"name": "T", "exercises": [{"exercise_id": ex, "sets": 3, "reps": 10}]}]}
    ]
    prog = _make_program(actors, "uses-ex", weeks)
    h = actors["headers"]["content_manager"]
    actors["admin_client"].post(f"/api/v1/admin/programs/{prog}/submit-review", json={}, headers={**h, "Idempotency-Key": "t-de-1"})
    actors["admin_client"].post(f"/api/v1/admin/programs/{prog}/approve", json={}, headers={**h, "Idempotency-Key": "t-de-2"})
    actors["admin_client"].post(f"/api/v1/admin/programs/{prog}/publish", json={"version": 1, "confirm": True}, headers={**h, "Idempotency-Key": "t-de-3"})
    r = actors["admin_client"].delete(f"/api/v1/admin/exercises/{ex}", headers={**h, "Idempotency-Key": "t-de-4"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "IN_USE_BY_PUBLISHED_PROGRAM"


def test_exercise_unpublish_keeps_history(actors, db_session):
    from app.admin.models_content import Exercise
    from uuid import UUID

    ex = _create_ex(actors, "unpub-me")
    h = actors["headers"]["content_manager"]
    assert actors["admin_client"].post(f"/api/v1/admin/exercises/{ex}/publish", json={"confirm": True}, headers={**h, "Idempotency-Key": "t-uu-1"}).status_code == 200
    r = actors["admin_client"].post(f"/api/v1/admin/exercises/{ex}/unpublish", json={"confirm": True}, headers={**h, "Idempotency-Key": "t-uu-2"})
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "ARCHIVED"
    obj = db_session.query(Exercise).filter(Exercise.id == UUID(ex)).first()
    # history is preserved: version counter kept, audit trail records the publication
    assert obj.published_version == 1
    r = actors["admin_client"].get(
        "/api/v1/admin/audit-logs?resource_type=exercise&action=admin.content.published", headers=actors["headers"]["super_admin"]
    )
    assert any(row["resource_id"] == str(ex) for row in r.json()["data"]["items"])
