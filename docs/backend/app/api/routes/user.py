"""User profile and admin user routes."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import SuccessResponse
from app.schemas.user import UserDetailResponse, UserUpdate
from app.middleware.rbac import get_current_user, require_role
from app.models import User
from app.services.audit import record_audit

router = APIRouter(prefix="/users", tags=["users"])


def user_to_dict(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "role": user.role,
        "timezone": user.timezone,
        "is_active": user.is_active,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


@router.get("/me", response_model=SuccessResponse)
def read_current_user(user: User = Depends(get_current_user)):
    return SuccessResponse(data=user_to_dict(user))


@router.put("/me", response_model=SuccessResponse)
def update_current_user(
    payload: UserUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.first_name is not None:
        user.first_name = payload.first_name
    if payload.last_name is not None:
        user.last_name = payload.last_name
    if payload.timezone is not None:
        user.timezone = payload.timezone

    db.add(user)
    db.commit()
    db.refresh(user)

    record_audit(
        action="update_user_profile",
        user_id=str(user.id),
        entity_type="user",
        entity_id=str(user.id),
        changes=payload.model_dump(exclude_none=True),
    )

    return SuccessResponse(data=user_to_dict(user))


@router.get("/", response_model=SuccessResponse)
def list_users(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    users = db.query(User).all()
    return SuccessResponse(
        data={
            "count": len(users),
            "items": [user_to_dict(u) for u in users],
        }
    )


@router.get("/{user_id}", response_model=SuccessResponse)
def get_user(user_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return SuccessResponse(data=user_to_dict(target))


@router.delete("/{user_id}", response_model=SuccessResponse)
def delete_user(user_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    db.delete(target)
    db.commit()

    record_audit(
        action="delete_user",
        user_id=str(user.id),
        entity_type="user",
        entity_id=str(user_id),
        changes={"deleted": True},
    )

    return SuccessResponse(data={"deleted": True, "id": str(user_id)})
