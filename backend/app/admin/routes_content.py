"""Content admin routes (SPEC-011 6.5, 6.6): exercises + alternatives, media,
programs with the DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> ARCHIVED workflow."""
import base64
import os
import secrets
from datetime import datetime
from typing import List, Optional
from uuid import UUID as PyUUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import User

from . import auth, models
from .audit import write_admin_audit
from .common import err_response, ok, paginate_params, require_confirm, reject_unknown_query_params
from .masking import ip_hash
from .models_content import (
    CONTENT_TRANSITIONS,
    ContentStatus,
    Exercise,
    ExerciseAlternative,
    ExerciseType,
    MediaAsset,
    MediaKind,
    MediaStatus,
    Program,
    ProgramVersion,
)
from .schemas import (
    AlternativeCreate,
    ExerciseCreate,
    ExerciseUpdate,
    MediaCreate,
    ProgramCreate,
    ProgramUpdate,
    PublishRequest,
    RollbackRequest,
    StatusTransitionRequest,
    UnpublishRequest,
)

settings = get_settings()
router = APIRouter(prefix="/admin", tags=["admin-content"])

IMAGE_MIME = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
VIDEO_MIME = {"video/mp4": ".mp4"}


def _audit(db, request, actor, action, resource_type, resource_id=None, result=None, reason=None, before_summary=None, after_summary=None):
    write_admin_audit(
        db,
        actor=actor,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        result=result or models.AuditResult.SUCCESS,
        reason=reason,
        request_id=getattr(request.state, "request_id", "unknown"),
        ip_hash=ip_hash(request.client.host if request.client else None, settings.AUDIT_IP_SALT),
        before_summary=before_summary,
        after_summary=after_summary,
    )


# ============================= EXERCISES =============================

def _exercise_dict(e: Exercise, with_alternatives: bool = False, db: Session = None) -> dict:
    d = {
        "id": str(e.id),
        "title": e.title,
        "slug": e.slug,
        "description": e.description,
        "type": e.type.value if hasattr(e.type, "value") else str(e.type),
        "difficulty": e.difficulty,
        "muscle_groups": e.muscle_groups,
        "equipment": e.equipment,
        "unit": e.unit,
        "contraindications": e.contraindications,
        "localizations": e.localizations,
        "media_ids": [str(m) for m in (e.media_ids or [])],
        "status": e.status.value if hasattr(e.status, "value") else str(e.status),
        "published_version": e.published_version,
        "version": e.version,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }
    if with_alternatives and db is not None:
        alts = db.query(ExerciseAlternative).filter(ExerciseAlternative.exercise_id == e.id).all()
        d["alternatives"] = [
            {
                "id": str(a.id),
                "alternative_exercise_id": str(a.alternative_exercise_id),
                "note": a.note,
            }
            for a in alts
        ]
    return d


@router.get("/exercises")
def list_exercises(
    request: Request,
    q: Optional[str] = None,
    type: Optional[str] = None,
    status_filter: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    sort: Optional[str] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:read")),
):
    reject_unknown_query_params(request)
    page, page_size, sort = paginate_params(page, pageSize, sort)
    query = db.query(Exercise).filter(Exercise.deleted_at.is_(None))
    if q:
        query = query.filter(or_(Exercise.title.ilike(f"%{q}%"), Exercise.slug.ilike(f"%{q}%")))
    if type:
        if type not in [t.value for t in ExerciseType]:
            raise err_response("VALIDATION_ERROR", f"unknown type: {type}", 400)
        query = query.filter(Exercise.type == type)
    if status_filter:
        if status_filter not in [s.value for s in ContentStatus]:
            raise err_response("VALIDATION_ERROR", f"unknown status: {status_filter}", 400)
        query = query.filter(Exercise.status == status_filter)
    total = query.count()
    items = query.order_by(Exercise.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok({"items": [_exercise_dict(e) for e in items], "page": page, "pageSize": page_size, "total": total})


@router.get("/exercises/{exercise_id}")
def get_exercise(
    exercise_id: PyUUID,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:read")),
):
    e = db.query(Exercise).filter(Exercise.id == exercise_id, Exercise.deleted_at.is_(None)).first()
    if not e:
        raise err_response("NOT_FOUND", "Exercise not found", 404)
    return ok(_exercise_dict(e, with_alternatives=True, db=db))


def _validate_exercise_payload(title: str, slug: str, type_val: str, difficulty: int, description, localizations, db, exclude_id=None):
    errors = []
    if not title or not title.strip():
        errors.append("title is required")
    if not slug:
        errors.append("slug is required")
    existing = db.query(Exercise).filter(Exercise.slug == slug, Exercise.deleted_at.is_(None))
    if exclude_id:
        existing = existing.filter(Exercise.id != exclude_id)
    if existing.first():
        errors.append(f"slug '{slug}' already exists")
    if description is None and not localizations:
        errors.append("description or localizations is required")
    return errors


@router.post("/exercises", status_code=201)
def create_exercise(
    payload: ExerciseCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:write")),
):
    errors = _validate_exercise_payload(payload.title, payload.slug, payload.type, payload.difficulty, payload.description, payload.localizations, db)
    if errors:
        raise err_response("VALIDATION_ERROR", "Exercise validation failed", 400, errors)
    e = Exercise(
        title=payload.title.strip(),
        slug=payload.slug,
        description=payload.description,
        type=ExerciseType(payload.type),
        difficulty=payload.difficulty,
        muscle_groups=payload.muscle_groups,
        equipment=payload.equipment,
        instructions=payload.instructions,
        contraindications=payload.contraindications,
        unit=payload.unit,
        localizations=payload.localizations,
        media_ids=[str(m) for m in (payload.media_ids or [])],
        status=ContentStatus.DRAFT,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    _audit(db, request, actor, "admin.content.created", "exercise", e.id, after_summary=_exercise_dict(e))
    return ok(_exercise_dict(e))


@router.patch("/exercises/{exercise_id}")
def update_exercise(
    exercise_id: PyUUID,
    payload: ExerciseUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:write")),
):
    e = db.query(Exercise).filter(Exercise.id == exercise_id, Exercise.deleted_at.is_(None)).first()
    if not e:
        raise err_response("NOT_FOUND", "Exercise not found", 404)
    if e.status == ContentStatus.PUBLISHED:
        raise err_response("PUBLISHED_LOCKED", "Unpublish (archive) the exercise before editing", 409)

    before = _exercise_dict(e)
    data = payload.model_dump(exclude_unset=True)
    if "status" in data:
        data.pop("status")  # status moves only via workflow endpoints
    for field, value in data.items():
        setattr(e, field, [str(m) for m in value] if field == "media_ids" else value)
    e.version = (e.version or 1) + 1
    db.commit()
    db.refresh(e)
    _audit(db, request, actor, "admin.content.updated", "exercise", e.id, before_summary=before, after_summary=_exercise_dict(e))
    return ok(_exercise_dict(e))


def _find_cycle(exercise_id, alternative_id, db) -> bool:
    """True if adding edge exercise_id -> alternative_id would create a cycle in the alternatives graph."""
    if exercise_id == alternative_id:
        return True
    adjacency = {}
    rows = db.query(ExerciseAlternative.exercise_id, ExerciseAlternative.alternative_exercise_id).all()
    for src, dst in rows:
        adjacency.setdefault(src, set()).add(dst)
    stack, seen = [alternative_id], set()
    while stack:
        node = stack.pop()
        if node == exercise_id:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(adjacency.get(node, ()))
    return False


@router.post("/exercises/{exercise_id}/alternatives", status_code=201)
def add_alternative(
    exercise_id: PyUUID,
    payload: AlternativeCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:write")),
):
    e = db.query(Exercise).filter(Exercise.id == exercise_id, Exercise.deleted_at.is_(None)).first()
    alt = db.query(Exercise).filter(Exercise.id == payload.alternative_exercise_id, Exercise.deleted_at.is_(None)).first()
    if not e or not alt:
        raise err_response("NOT_FOUND", "Exercise or alternative not found", 404)

    # Compatibility: same load type or overlapping target muscle groups (SPEC-011 6.5)
    same_type = e.type == alt.type
    overlapping = bool(set(e.muscle_groups or []) & set(alt.muscle_groups or []))
    if not (same_type or overlapping):
        raise err_response("INCOMPATIBLE_ALTERNATIVE", "Alternative must share load type or target muscle group", 400)

    if _find_cycle(e.id, alt.id, db):
        raise err_response("CYCLICAL_ALTERNATIVE", "Adding this alternative would create a cycle", 400)

    exists = (
        db.query(ExerciseAlternative)
        .filter(ExerciseAlternative.exercise_id == e.id, ExerciseAlternative.alternative_exercise_id == alt.id)
        .first()
    )
    if exists:
        raise err_response("ALREADY_EXISTS", "Alternative already exists", 409)

    link = ExerciseAlternative(exercise_id=e.id, alternative_exercise_id=alt.id, note=payload.note)
    db.add(link)
    db.commit()
    db.refresh(link)
    _audit(db, request, actor, "admin.content.updated", "exercise_alternative", link.id, reason=f"{e.slug} -> {alt.slug}")
    return ok({"id": str(link.id), "exercise_id": str(e.id), "alternative_exercise_id": str(alt.id)})


@router.delete("/exercises/{exercise_id}/alternatives/{alternative_id}")
def remove_alternative(
    exercise_id: PyUUID,
    alternative_id: PyUUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:write")),
):
    link = (
        db.query(ExerciseAlternative)
        .filter(ExerciseAlternative.id == alternative_id, ExerciseAlternative.exercise_id == exercise_id)
        .first()
    )
    if not link:
        raise err_response("NOT_FOUND", "Alternative not found", 404)
    db.delete(link)
    db.commit()
    _audit(db, request, actor, "admin.content.updated", "exercise_alternative", alternative_id, reason="removed")
    return ok({"deleted": True})


def _exercise_publish_errors(e: Exercise, db) -> List[str]:
    errors = []
    if not e.title or not e.slug:
        errors.append("title and slug are required")
    if e.description is None and not e.localizations:
        errors.append("description or localizations required before publish")
    for media_id in (e.media_ids or []):
        try:
            mid = PyUUID(str(media_id))
        except (ValueError, TypeError):
            errors.append(f"media {media_id} has an invalid id")
            continue
        m = db.query(MediaAsset).filter(MediaAsset.id == mid).first()
        if not m or m.status != MediaStatus.VALIDATED:
            errors.append(f"media {media_id} is missing or failed validation")
    return errors


@router.post("/exercises/{exercise_id}/publish")
def publish_exercise(
    exercise_id: PyUUID,
    payload: StatusTransitionRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:publish", critical=True)),
):
    require_confirm(payload, settings)
    e = db.query(Exercise).filter(Exercise.id == exercise_id, Exercise.deleted_at.is_(None)).first()
    if not e:
        raise err_response("NOT_FOUND", "Exercise not found", 404)
    if e.status == ContentStatus.PUBLISHED:
        raise err_response("ALREADY_PUBLISHED", "Exercise is already published", 409)
    errors = _exercise_publish_errors(e, db)
    if errors:
        _audit(db, request, actor, "admin.content.published", "exercise", e.id, result=models.AuditResult.FAILED, reason="; ".join(errors))
        raise err_response("VALIDATION_ERROR", "Exercise cannot be published", 400, errors)

    before = {"status": e.status.value}
    e.status = ContentStatus.PUBLISHED
    e.published_version = (e.published_version or 0) + 1
    e.version = (e.version or 1) + 1
    db.commit()
    _audit(db, request, actor, "admin.content.published", "exercise", e.id, before_summary=before, after_summary={"status": "PUBLISHED", "version": e.published_version})
    return ok({"id": str(e.id), "status": "PUBLISHED", "published_version": e.published_version})


@router.post("/exercises/{exercise_id}/unpublish")
def unpublish_exercise(
    exercise_id: PyUUID,
    payload: StatusTransitionRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:publish", critical=True)),
):
    require_confirm(payload, settings)
    e = db.query(Exercise).filter(Exercise.id == exercise_id, Exercise.deleted_at.is_(None)).first()
    if not e:
        raise err_response("NOT_FOUND", "Exercise not found", 404)
    if e.status != ContentStatus.PUBLISHED:
        raise err_response("INVALID_TRANSITION", "Only PUBLISHED exercises can be unpublished", 409)
    before = {"status": "PUBLISHED", "published_version": e.published_version}
    e.status = ContentStatus.ARCHIVED
    e.version = (e.version or 1) + 1
    db.commit()
    _audit(db, request, actor, "admin.content.unpublished", "exercise", e.id, before_summary=before, after_summary={"status": "ARCHIVED"})
    return ok({"id": str(e.id), "status": "ARCHIVED"})


def _used_by_published_programs(db, exercise_id) -> int:
    from sqlalchemy import func, literal

    count = 0
    for p in db.query(Program).filter(Program.status == ContentStatus.PUBLISHED, Program.deleted_at.is_(None)).all():
        for week in (p.weeks or []):
            for workout in (week.get("workouts") or []):
                for item in (workout.get("exercises") or []):
                    if str(item.get("exercise_id")) == str(exercise_id):
                        count += 1
    return count


@router.delete("/exercises/{exercise_id}")
def delete_exercise(
    exercise_id: PyUUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:write", critical=True)),
):
    """Soft delete only. Blocked when the exercise is used by a published program (SPEC-011 6.5)."""
    e = db.query(Exercise).filter(Exercise.id == exercise_id, Exercise.deleted_at.is_(None)).first()
    if not e:
        raise err_response("NOT_FOUND", "Exercise not found", 404)
    used = _used_by_published_programs(db, e.id)
    if used > 0:
        raise err_response(
            "IN_USE_BY_PUBLISHED_PROGRAM",
            f"Exercise is used by {used} published program(s); archive or migrate first",
            409,
        )
    if e.status == ContentStatus.PUBLISHED:
        raise err_response("PUBLISHED_LOCKED", "Unpublish the exercise before deleting", 409)
    e.deleted_at = datetime.utcnow()
    db.commit()
    _audit(db, request, actor, "admin.content.deleted", "exercise", e.id, after_summary={"status": "DELETED"})
    return ok({"deleted": True})


# ============================= MEDIA =============================

MAGIC = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/webp": None,  # RIFF....WEBP checked separately
    "video/mp4": None,  # ....ftyp checked separately
}


def _validate_media_bytes(data: bytes, mime: str, kind: str):
    if kind == "IMAGE" and mime not in IMAGE_MIME:
        return f"mime type {mime} not allowed for images"
    if kind == "VIDEO" and mime not in VIDEO_MIME:
        return f"mime type {mime} not allowed for videos"
    limit = settings.MEDIA_MAX_IMAGE_SIZE if kind == "IMAGE" else settings.MEDIA_MAX_VIDEO_SIZE
    if len(data) > limit:
        return f"file exceeds size limit ({limit} bytes)"
    if mime == "image/webp":
        if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
            return "content does not match WEBP magic bytes"
        return None
    if mime == "video/mp4":
        if len(data) < 12 or data[4:8] != b"ftyp":
            return "content does not match MP4 magic bytes"
        return None
    prefix = MAGIC.get(mime)
    if prefix and not data.startswith(prefix):
        return "content does not match declared mime type"
    return None


def _exercise_program_media_refs(db) -> set:
    refs = set()
    for e in db.query(Exercise).filter(Exercise.status == ContentStatus.PUBLISHED, Exercise.deleted_at.is_(None)).all():
        for m in (e.media_ids or []):
            refs.add(str(m))
    for p in db.query(Program).filter(Program.status == ContentStatus.PUBLISHED, Program.deleted_at.is_(None)).all():
        for m in (p.media_ids or []):
            refs.add(str(m))
    return refs


@router.post("/media", status_code=201)
def upload_media(
    payload: MediaCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("media:write")),
):
    """MVP upload: direct content with full backend validation (MIME allowlist + magic bytes
    + size + checksum). Production swaps the transport for a pre-signed URL while keeping
    the same backend confirmation/validation pipeline (SPEC-011 6.5)."""
    try:
        data = base64.b64decode(payload.content_base64, validate=True)
    except Exception:
        raise err_response("VALIDATION_ERROR", "content_base64 is not valid base64", 400)

    problem = _validate_media_bytes(data, payload.mime_type, payload.kind)
    if problem:
        _audit(db, request, actor, "admin.media.rejected", "media", reason=f"{payload.filename}: {problem}")
        raise err_response("MEDIA_REJECTED", problem, 400)

    import hashlib

    checksum = hashlib.sha256(data).hexdigest()
    token = secrets.token_urlsafe(16)
    ext = (IMAGE_MIME if payload.kind == "IMAGE" else VIDEO_MIME)[payload.mime_type]
    os.makedirs(settings.MEDIA_STORAGE_DIR, exist_ok=True)
    path = os.path.join(settings.MEDIA_STORAGE_DIR, f"{token}{ext}")
    with open(path, "wb") as f:
        f.write(data)

    asset = MediaAsset(
        filename=payload.filename,
        kind=MediaKind(payload.kind),
        mime_type=payload.mime_type,
        size_bytes=len(data),
        checksum_sha256=checksum,
        status=MediaStatus.VALIDATED,
        storage_path=path,
        public_token=token,
        alt_text=payload.alt_text,
        created_by=actor.id,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    _audit(
        db,
        request,
        actor,
        "admin.media.uploaded",
        "media",
        asset.id,
        after_summary={"filename": asset.filename, "size_bytes": asset.size_bytes, "checksum_sha256": asset.checksum_sha256[:16] + "..."},
    )
    return ok(
        {
            "id": str(asset.id),
            "filename": asset.filename,
            "kind": asset.kind.value,
            "mime_type": asset.mime_type,
            "size_bytes": asset.size_bytes,
            "checksum_sha256": asset.checksum_sha256,
            "public_url": f"/api/v1/admin/media/download/{asset.public_token}",
            "status": asset.status.value,
        }
    )


@router.get("/media")
def list_media(
    request: Request,
    kind: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("media:read")),
):
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    q = db.query(MediaAsset).filter(MediaAsset.deleted_at.is_(None))
    if kind:
        q = q.filter(MediaAsset.kind == kind)
    total = q.count()
    items = q.order_by(MediaAsset.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok(
        {
            "items": [
                {
                    "id": str(m.id),
                    "filename": m.filename,
                    "kind": m.kind.value,
                    "mime_type": m.mime_type,
                    "size_bytes": m.size_bytes,
                    "checksum_sha256": m.checksum_sha256,
                    "status": m.status.value,
                    "public_url": f"/api/v1/admin/media/download/{m.public_token}",
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in items
            ],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    )


@router.get("/media/{media_id}")
def get_media(
    media_id: PyUUID,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("media:read")),
):
    m = db.query(MediaAsset).filter(MediaAsset.id == media_id, MediaAsset.deleted_at.is_(None)).first()
    if not m:
        raise err_response("NOT_FOUND", "Media not found", 404)
    return ok(
        {
            "id": str(m.id),
            "filename": m.filename,
            "kind": m.kind.value,
            "mime_type": m.mime_type,
            "size_bytes": m.size_bytes,
            "checksum_sha256": m.checksum_sha256,
            "alt_text": m.alt_text,
            "status": m.status.value,
            "public_url": f"/api/v1/admin/media/download/{m.public_token}",
            # storage_path intentionally never exposed (SPEC-011 6.5)
        }
    )


@router.get("/media/download/{public_token}")
def download_media(public_token: str, db: Session = Depends(get_db), actor: User = Depends(auth.require_permission("media:read"))):
    m = db.query(MediaAsset).filter(MediaAsset.public_token == public_token, MediaAsset.deleted_at.is_(None)).first()
    if not m or not m.storage_path or not os.path.exists(m.storage_path):
        raise err_response("NOT_FOUND", "Media not found", 404)
    return FileResponse(m.storage_path, media_type=m.mime_type, filename=m.filename)


@router.delete("/media/{media_id}")
def delete_media(
    media_id: PyUUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("media:delete", critical=True)),
):
    """Delete blocked when referenced by published content (SPEC-011 6.5)."""
    m = db.query(MediaAsset).filter(MediaAsset.id == media_id, MediaAsset.deleted_at.is_(None)).first()
    if not m:
        raise err_response("NOT_FOUND", "Media not found", 404)
    if str(m.id) in _exercise_program_media_refs(db):
        raise err_response("IN_USE_BY_PUBLISHED_CONTENT", "Media is referenced by published content", 409)
    if m.storage_path and os.path.exists(m.storage_path):
        os.remove(m.storage_path)
    m.deleted_at = datetime.utcnow()
    m.storage_path = None
    db.commit()
    _audit(db, request, actor, "admin.media.deleted", "media", m.id)
    return ok({"deleted": True})


# ============================= PROGRAMS =============================

REQUIRED_LOCALE = "ru"


def _validate_program_for_publish(p: Program, db) -> List[str]:
    """All pre-publish checks from SPEC-011 6.6."""
    errors = []
    # slug uniqueness
    if db.query(Program).filter(Program.slug == p.slug, Program.id != p.id, Program.deleted_at.is_(None)).first():
        errors.append(f"slug '{p.slug}' already exists")
    # name/description on required locale
    loc = (p.localizations or {}).get(REQUIRED_LOCALE) or {}
    if not (p.title and (p.description or loc.get("description"))):
        errors.append(f"title and description on locale '{REQUIRED_LOCALE}' are required")
    # duration and at least one workout
    if not p.duration_minutes:
        errors.append("duration_minutes is required")
    weeks = p.weeks or []
    if not weeks:
        errors.append("program must contain at least one week")
    exercise_refs = []
    total_workouts = 0
    for w_i, week in enumerate(weeks):
        workouts = week.get("workouts") or []
        total_workouts += len(workouts)
        for wo_i, workout in enumerate(workouts):
            items = workout.get("exercises") or []
            if not items:
                errors.append(f"week {w_i + 1} workout {wo_i + 1} has no exercises")
            for it_i, item in enumerate(items):
                try:
                    ex_id = PyUUID(str(item.get("exercise_id")))
                except (ValueError, TypeError):
                    errors.append(f"week {w_i + 1} workout {wo_i + 1}: invalid exercise_id")
                    continue
                exercise_refs.append(ex_id)
                # ranges: sets / reps / rest / weight
                sets = item.get("sets")
                reps = item.get("reps")
                rest = item.get("rest_seconds", 0)
                weight = item.get("weight")
                if not isinstance(sets, int) or not (1 <= sets <= 30):
                    errors.append(f"week {w_i + 1} workout {wo_i + 1} item {it_i + 1}: sets must be 1..30")
                if not isinstance(reps, int) or not (1 <= reps <= 500):
                    errors.append(f"week {w_i + 1} workout {wo_i + 1} item {it_i + 1}: reps must be 1..500")
                if not isinstance(rest, int) or not (0 <= rest <= 600):
                    errors.append(f"week {w_i + 1} workout {wo_i + 1} item {it_i + 1}: rest must be 0..600")
                if weight is not None and (not isinstance(weight, (int, float)) or weight < 0):
                    errors.append(f"week {w_i + 1} workout {wo_i + 1} item {it_i + 1}: weight must be >= 0")
    if total_workouts == 0:
        errors.append("program must contain at least one workout")

    # exercises exist, not deleted, equipment compatibility, alternatives cycles
    seen = set()
    for ex_id in exercise_refs:
        if ex_id in seen:
            continue
        seen.add(ex_id)
        ex = db.query(Exercise).filter(Exercise.id == ex_id).first()
        if not ex:
            errors.append(f"exercise {ex_id} does not exist")
            continue
        if ex.deleted_at is not None:
            errors.append(f"exercise {ex_id} is deleted")
            continue
        if p.equipment and ex.equipment:
            missing = set(ex.equipment) - set(p.equipment)
            if missing:
                errors.append(f"exercise '{ex.title}' requires equipment not in program: {sorted(missing)}")

    # cycles among referenced exercises (direct + transitive)
    referenced = [str(i) for i in seen]
    for src_id in referenced:
        if _find_cycle_cycle_check(db, PyUUID(src_id), referenced):
            errors.append(f"alternative cycle detected involving exercise {src_id}")
            break
    return errors


def _find_cycle_cycle_check(db, start: PyUUID, nodes: List[str]) -> bool:
    """Return True if, restricted to `nodes`, start can reach itself through alternatives."""
    node_set = set(nodes)
    adjacency = {}
    for src, dst in db.query(ExerciseAlternative.exercise_id, ExerciseAlternative.alternative_exercise_id).all():
        if str(src) in node_set and str(dst) in node_set:
            adjacency.setdefault(str(src), set()).add(str(dst))
    stack, seen = [start], set()
    while stack:
        node = stack.pop()
        for nxt in adjacency.get(str(node), ()):
            if nxt == str(start):
                return True
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return False


def _program_dict(p: Program, db=None, with_weeks: bool = True) -> dict:
    d = {
        "id": str(p.id),
        "title": p.title,
        "slug": p.slug,
        "description": p.description,
        "goal": p.goal,
        "level": p.level,
        "equipment": p.equipment,
        "duration_minutes": p.duration_minutes,
        "progression_rules": p.progression_rules,
        "localizations": p.localizations,
        "media_ids": [str(m) for m in (p.media_ids or [])],
        "status": p.status.value if hasattr(p.status, "value") else str(p.status),
        "published_version": p.published_version,
        "version": p.version,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }
    if with_weeks:
        d["weeks"] = p.weeks
    return d


@router.get("/programs")
def list_programs(
    request: Request,
    q: Optional[str] = None,
    status_filter: Optional[str] = None,
    page: int = 1,
    pageSize: int = 20,
    sort: Optional[str] = None,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:read")),
):
    reject_unknown_query_params(request)
    page, page_size, sort = paginate_params(page, pageSize, sort)
    query = db.query(Program).filter(Program.deleted_at.is_(None))
    if q:
        query = query.filter(or_(Program.title.ilike(f"%{q}%"), Program.slug.ilike(f"%{q}%")))
    if status_filter:
        if status_filter not in [s.value for s in ContentStatus]:
            raise err_response("VALIDATION_ERROR", f"unknown status: {status_filter}", 400)
        query = query.filter(Program.status == status_filter)
    total = query.count()
    items = query.order_by(Program.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok(
        {
            "items": [
                {
                    "id": str(p.id),
                    "title": p.title,
                    "slug": p.slug,
                    "status": p.status.value,
                    "published_version": p.published_version,
                    "duration_minutes": p.duration_minutes,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                }
                for p in items
            ],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    )


@router.get("/programs/{program_id}")
def get_program(
    program_id: PyUUID,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:read")),
):
    p = db.query(Program).filter(Program.id == program_id, Program.deleted_at.is_(None)).first()
    if not p:
        raise err_response("NOT_FOUND", "Program not found", 404)
    versions = db.query(ProgramVersion).filter(ProgramVersion.program_id == p.id).order_by(ProgramVersion.version.desc()).all()
    return ok(
        {
            **_program_dict(p, db),
            "versions": [
                {
                    "id": str(v.id),
                    "version": v.version,
                    "changelog": v.changelog,
                    "published_at": v.published_at.isoformat() if v.published_at else None,
                    "reverted": v.reverted,
                }
                for v in versions
            ],
        }
    )


@router.post("/programs", status_code=201)
def create_program(
    payload: ProgramCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:write")),
):
    if db.query(Program).filter(Program.slug == payload.slug, Program.deleted_at.is_(None)).first():
        raise err_response("VALIDATION_ERROR", f"slug '{payload.slug}' already exists", 400)
    p = Program(
        title=payload.title.strip(),
        slug=payload.slug,
        description=payload.description,
        goal=payload.goal,
        level=payload.level,
        equipment=payload.equipment,
        duration_minutes=payload.duration_minutes,
        weeks=payload.weeks,
        progression_rules=payload.progression_rules,
        localizations=payload.localizations,
        media_ids=[str(m) for m in (payload.media_ids or [])],
        status=ContentStatus.DRAFT,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    _audit(db, request, actor, "admin.content.created", "program", p.id, after_summary={"slug": p.slug, "status": "DRAFT"})
    return ok(_program_dict(p, db))


@router.patch("/programs/{program_id}")
def update_program(
    program_id: PyUUID,
    payload: ProgramUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:write")),
):
    p = db.query(Program).filter(Program.id == program_id, Program.deleted_at.is_(None)).first()
    if not p:
        raise err_response("NOT_FOUND", "Program not found", 404)
    if p.status in (ContentStatus.PUBLISHED, ContentStatus.IN_REVIEW):
        raise err_response("WORKFLOW_LOCKED", "Program is in review/published; move it back to DRAFT or create a new version", 409)

    before = {"title": p.title, "duration_minutes": p.duration_minutes, "status": p.status.value}
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(p, field, [str(m) for m in value] if field == "media_ids" else value)
    p.version = (p.version or 1) + 1
    db.commit()
    db.refresh(p)
    _audit(db, request, actor, "admin.content.updated", "program", p.id, before_summary=before, after_summary={"title": p.title, "status": p.status.value})
    return ok(_program_dict(p, db))


def _transition(
    db, request, actor, p: Program, target: ContentStatus, action: str, permission: str, critical: bool,
    confirm_payload, extra_checks=None,
):
    allowed = CONTENT_TRANSITIONS.get(p.status, set())
    if target not in allowed:
        raise err_response("INVALID_TRANSITION", f"Cannot move from {p.status.value} to {target.value}", 409)
    if confirm_payload is not None:
        require_confirm(confirm_payload, settings)
    errors = [] if extra_checks is None else extra_checks()
    if errors:
        _audit(db, request, actor, action, "program", p.id, result=models.AuditResult.FAILED, reason="; ".join(errors))
        raise err_response("VALIDATION_ERROR", "Program validation failed", 400, errors)
    before = {"status": p.status.value, "published_version": p.published_version}
    p.status = target
    p.version = (p.version or 1) + 1
    db.commit()
    db.refresh(p)
    _audit(db, request, actor, action, "program", p.id, before_summary=before, after_summary={"status": p.status.value})
    return p


@router.post("/programs/{program_id}/submit-review")
def submit_review(
    program_id: PyUUID,
    payload: StatusTransitionRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:write")),
):
    p = db.query(Program).filter(Program.id == program_id, Program.deleted_at.is_(None)).first()
    if not p:
        raise err_response("NOT_FOUND", "Program not found", 404)
    errors = _validate_program_for_publish(p, db)
    # A program may be submitted to review even with minor gaps? No — SPEC-011 6.6:
    # «Программа проходит все проверки перед IN_REVIEW и публикацией».
    if errors:
        _audit(db, request, actor, "admin.content.updated", "program", p.id, result=models.AuditResult.FAILED, reason="; ".join(errors))
        raise err_response("VALIDATION_ERROR", "Program does not pass validation", 400, errors)
    _transition(db, request, actor, p, ContentStatus.IN_REVIEW, "admin.content.updated", "content:write", False, None)
    return ok({"id": str(p.id), "status": p.status.value})


@router.post("/programs/{program_id}/approve")
def approve_program(
    program_id: PyUUID,
    payload: StatusTransitionRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:publish")),
):
    p = db.query(Program).filter(Program.id == program_id, Program.deleted_at.is_(None)).first()
    if not p:
        raise err_response("NOT_FOUND", "Program not found", 404)
    _transition(db, request, actor, p, ContentStatus.APPROVED, "admin.content.updated", "content:publish", False, None)
    return ok({"id": str(p.id), "status": p.status.value})


@router.post("/programs/{program_id}/reject")
def reject_program(
    program_id: PyUUID,
    payload: StatusTransitionRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:publish")),
):
    p = db.query(Program).filter(Program.id == program_id, Program.deleted_at.is_(None)).first()
    if not p:
        raise err_response("NOT_FOUND", "Program not found", 404)
    _transition(db, request, actor, p, ContentStatus.REJECTED, "admin.content.updated", "content:publish", False, None)
    return ok({"id": str(p.id), "status": p.status.value})


@router.post("/programs/{program_id}/publish")
def publish_program(
    program_id: PyUUID,
    payload: PublishRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:publish", critical=True)),
):
    """Atomic publication: snapshot + status + audit in ONE transaction (SPEC-011 6.6, 9.11).
    Publication never modifies users' already-started workouts."""
    p = db.query(Program).filter(Program.id == program_id, Program.deleted_at.is_(None)).first()
    if not p:
        raise err_response("NOT_FOUND", "Program not found", 404)
    if p.status != ContentStatus.APPROVED:
        raise err_response("INVALID_TRANSITION", "Only APPROVED programs can be published", 409)
    errors = _validate_program_for_publish(p, db)
    if errors:
        _audit(db, request, actor, "admin.content.published", "program", p.id, result=models.AuditResult.FAILED, reason="; ".join(errors))
        raise err_response("VALIDATION_ERROR", "Program does not pass pre-publish validation", 400, errors)

    require_confirm(payload, settings)
    if payload.version != (p.published_version or 0) + 1:
        raise err_response("VERSION_MISMATCH", f"expected version {p.published_version + 1}", 409)

    snapshot = {
        "title": p.title,
        "slug": p.slug,
        "description": p.description,
        "goal": p.goal,
        "level": p.level,
        "equipment": p.equipment,
        "duration_minutes": p.duration_minutes,
        "weeks": p.weeks,
        "progression_rules": p.progression_rules,
        "localizations": p.localizations,
        "media_ids": p.media_ids,
    }
    try:
        version_row = ProgramVersion(
            program_id=p.id,
            version=payload.version,
            snapshot=snapshot,
            changelog=payload.reason,
            published_by=actor.id,
            published_at=datetime.utcnow(),
        )
        p.status = ContentStatus.PUBLISHED
        p.published_version = payload.version
        p.version = (p.version or 1) + 1
        db.add(version_row)
        db.commit()
    except Exception:
        db.rollback()
        _audit(db, request, actor, "admin.content.published", "program", p.id, result=models.AuditResult.FAILED, reason="publication transaction failed")
        raise err_response("PUBLICATION_FAILED", "Publication failed and was rolled back", 500)
    db.refresh(p)
    _audit(
        db,
        request,
        actor,
        "admin.content.published",
        "program",
        p.id,
        reason=payload.reason,
        before_summary={"status": "APPROVED"},
        after_summary={"status": "PUBLISHED", "version": payload.version},
    )
    return ok({"id": str(p.id), "status": "PUBLISHED", "published_version": payload.version})


@router.post("/programs/{program_id}/unpublish")
def unpublish_program(
    program_id: PyUUID,
    payload: UnpublishRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:publish", critical=True)),
):
    """Unpublish: program becomes ARCHIVED; history and audit are preserved (SPEC-011 11.3).
    SUPER_ADMIN (content:force_unpublish) may bypass the approval gate."""
    p = db.query(Program).filter(Program.id == program_id, Program.deleted_at.is_(None)).first()
    if not p:
        raise err_response("NOT_FOUND", "Program not found", 404)
    if p.status != ContentStatus.PUBLISHED:
        raise err_response("INVALID_TRANSITION", "Only PUBLISHED programs can be unpublished", 409)
    if not has_permission(actor.role, "content:force_unpublish"):
        require_confirm(payload, settings)

    before = {"status": "PUBLISHED", "published_version": p.published_version}
    p.status = ContentStatus.ARCHIVED
    p.version = (p.version or 1) + 1
    db.commit()
    _audit(
        db,
        request,
        actor,
        "admin.content.unpublished",
        "program",
        p.id,
        reason=payload.reason,
        before_summary=before,
        after_summary={"status": "ARCHIVED"},
    )
    return ok({"id": str(p.id), "status": "ARCHIVED"})


@router.get("/programs/{program_id}/versions")
def program_versions(
    program_id: PyUUID,
    request: Request,
    page: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:read")),
):
    reject_unknown_query_params(request)
    page, page_size, _ = paginate_params(page, pageSize, None)
    q = db.query(ProgramVersion).filter(ProgramVersion.program_id == program_id)
    total = q.count()
    items = q.order_by(ProgramVersion.version.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return ok(
        {
            "items": [
                {
                    "id": str(v.id),
                    "version": v.version,
                    "changelog": v.changelog,
                    "published_at": v.published_at.isoformat() if v.published_at else None,
                    "reverted": v.reverted,
                }
                for v in items
            ],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    )


@router.post("/programs/{program_id}/rollback")
def rollback_program(
    program_id: PyUUID,
    payload: RollbackRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(auth.require_permission("content:publish", critical=True)),
):
    """Rollback = publish a NEW version from an old snapshot (history stays intact)."""
    p = db.query(Program).filter(Program.id == program_id, Program.deleted_at.is_(None)).first()
    if not p:
        raise err_response("NOT_FOUND", "Program not found", 404)
    old = db.query(ProgramVersion).filter(ProgramVersion.program_id == p.id, ProgramVersion.version == payload.version).first()
    if not old:
        raise err_response("NOT_FOUND", "Version not found", 404)
    require_confirm(payload, settings)

    for field, key in (
        ("title", "title"),
        ("description", "description"),
        ("goal", "goal"),
        ("level", "level"),
        ("equipment", "equipment"),
        ("duration_minutes", "duration_minutes"),
        ("weeks", "weeks"),
        ("progression_rules", "progression_rules"),
        ("localizations", "localizations"),
        ("media_ids", "media_ids"),
    ):
        if key in old.snapshot:
            setattr(p, field, old.snapshot[key])
    new_version = (p.published_version or 0) + 1
    snapshot = dict(old.snapshot)
    version_row = ProgramVersion(
        program_id=p.id,
        version=new_version,
        snapshot=snapshot,
        changelog=f"rollback to version {payload.version}",
        published_by=actor.id,
        published_at=datetime.utcnow(),
    )
    old.reverted = True
    p.status = ContentStatus.PUBLISHED
    p.published_version = new_version
    p.version = (p.version or 1) + 1
    db.add(version_row)
    db.commit()
    _audit(
        db,
        request,
        actor,
        "admin.content.published",
        "program",
        p.id,
        reason=f"rollback from v{payload.version} to new v{new_version}",
        after_summary={"version": new_version},
    )
    return ok({"id": str(p.id), "status": "PUBLISHED", "published_version": new_version})


def has_permission(role: str, permission: str) -> bool:
    from .rbac import has_permission as _hp

    return _hp(role, permission)
