"""
User profile and admin user routes.
"""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import SuccessResponse
from app.schemas.user import UserDetailResponse, UserUpdate, TelegramBindTokenResponse
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


@router.post("/me/telegram-bind-token", response_model=SuccessResponse)
def generate_telegram_bind_token(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Generate a one-time token for binding Telegram account."""
    # Generate the token
    plain_token = user.generate_telegram_bind_token()
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Record audit
    record_audit(
        action="generate_telegram_bind_token",
        user_id=str(user.id),
        entity_type="user",
        entity_id=str(user.id),
        changes={"token_generated": True, "expires_at": user.telegram_bind_token_expires_at.isoformat()},
    )
    
    return SuccessResponse(data=TelegramBindTokenResponse(
        token=plain_token,
        expires_in=600  # 10 minutes in seconds
    ))


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


# We'll add a route to bind Telegram chat ID (could be done via the bot, but we'll also provide an API for completeness)
# However, the binding is done via the Telegram bot, so we don't need an API route for that.
# Instead, we'll handle the binding in the Telegram webhook when the user sends the token.