"""
Product configuration routes
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import SuccessResponse
from app.schemas.product_feature import (
    ProductFeatureCreate,
    ProductFeatureUpdate,
    ProductFeatureResponse,
    ProductFeatureListResponse,
)
from app.schemas.plan import PlanCreate, PlanUpdate, PlanResponse, PlanListResponse
from app.models import ProductFeature, Plan
from app.middleware.rbac import require_role
from app.services.audit import record_audit

router = APIRouter(
    prefix="/product",
    tags=["product"],
)


def feature_to_dict(feature: ProductFeature) -> dict:
    return {
        "id": str(feature.id),
        "code": feature.code,
        "name": feature.name,
        "description": feature.description,
        "release_stage": feature.release_stage,
        "enabled": feature.enabled,
        "created_at": feature.created_at,
        "updated_at": feature.updated_at,
    }


def plan_to_dict(plan: Plan) -> dict:
    return {
        "id": str(plan.id),
        "code": plan.code,
        "name": plan.name,
        "description": plan.description,
        "status": plan.status,
        "price": str(plan.price),
        "currency": plan.currency,
        "created_at": plan.created_at,
        "updated_at": plan.updated_at,
    }


@router.get("/config", response_model=SuccessResponse, tags=["public"])
async def get_product_config(db: Session = Depends(get_db)):
    """
    Get public product configuration

    Returns list of enabled features and active plans
    """
    features = db.query(ProductFeature).filter(ProductFeature.enabled == True).all()
    plans = db.query(Plan).filter(Plan.status == "active").all()

    config = {
        "features": [
            {
                "id": str(f.id),
                "code": f.code,
                "name": f.name,
                "release_stage": f.release_stage,
            }
            for f in features
        ],
        "plans": [
            {
                "id": str(p.id),
                "code": p.code,
                "name": p.name,
                "price": str(p.price),
                "currency": p.currency,
            }
            for p in plans
        ],
        "version": "1.0.0",
    }

    return SuccessResponse(data=config)


@router.get("/features", response_model=SuccessResponse)
def list_features(db: Session = Depends(get_db)):
    features = db.query(ProductFeature).all()
    return SuccessResponse(
        data={
            "page": 1,
            "pageSize": len(features),
            "total": len(features),
            "items": [feature_to_dict(f) for f in features],
        }
    )


@router.get("/plans", response_model=SuccessResponse)
def list_plans(db: Session = Depends(get_db)):
    plans = db.query(Plan).all()
    return SuccessResponse(
        data={
            "page": 1,
            "pageSize": len(plans),
            "total": len(plans),
            "items": [plan_to_dict(p) for p in plans],
        }
    )


@router.get("/feature/{feature_id}", response_model=SuccessResponse)
def get_feature(feature_id: UUID, db: Session = Depends(get_db)):
    feature = db.query(ProductFeature).filter(ProductFeature.id == feature_id).first()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")
    return SuccessResponse(data=feature_to_dict(feature))


@router.put("/feature/{feature_id}", response_model=SuccessResponse)
def update_feature(
    feature_id: UUID,
    payload: ProductFeatureUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role("content_manager")),
):
    feature = db.query(ProductFeature).filter(ProductFeature.id == feature_id).first()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    changes = {}
    if payload.name is not None:
        feature.name = payload.name
        changes["name"] = payload.name
    if payload.description is not None:
        feature.description = payload.description
        changes["description"] = payload.description
    if payload.release_stage is not None:
        feature.release_stage = payload.release_stage
        changes["release_stage"] = payload.release_stage
    if payload.enabled is not None:
        feature.enabled = payload.enabled
        changes["enabled"] = payload.enabled

    db.add(feature)
    db.commit()
    db.refresh(feature)

    record_audit(
        action="update_feature",
        user_id=str(user.id),
        entity_type="product_feature",
        entity_id=str(feature.id),
        changes=changes,
    )

    return SuccessResponse(data=feature_to_dict(feature))


@router.delete("/feature/{feature_id}", response_model=SuccessResponse)
def delete_feature(feature_id: UUID, db: Session = Depends(get_db), user=Depends(require_role("content_manager"))):
    feature = db.query(ProductFeature).filter(ProductFeature.id == feature_id).first()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    db.delete(feature)
    db.commit()

    record_audit(
        action="delete_feature",
        user_id=str(user.id),
        entity_type="product_feature",
        entity_id=str(feature.id),
        changes={"deleted": True},
    )

    return SuccessResponse(data={"deleted": True, "id": str(feature.id)})


@router.post("/feature", response_model=SuccessResponse)
def create_feature(payload: ProductFeatureCreate, db: Session = Depends(get_db), user=Depends(require_role("content_manager"))):
    existing = db.query(ProductFeature).filter(ProductFeature.code == payload.code).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Feature code already exists")

    f = ProductFeature(
        code=payload.code,
        name=payload.name,
        description=payload.description or "",
        release_stage=payload.release_stage,
        enabled=payload.enabled,
    )
    db.add(f)
    db.commit()
    db.refresh(f)

    record_audit(action="create_feature", user_id=str(user.id), entity_type="product_feature", entity_id=str(f.id), changes={"code": f.code})

    return SuccessResponse(data={"id": str(f.id), "feature": feature_to_dict(f)})


@router.get("/plan/{plan_id}", response_model=SuccessResponse)
def get_plan(plan_id: UUID, db: Session = Depends(get_db)):
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    return SuccessResponse(data=plan_to_dict(plan))


@router.put("/plan/{plan_id}", response_model=SuccessResponse)
def update_plan(
    plan_id: UUID,
    payload: PlanUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role("content_manager")),
):
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    changes = {}
    if payload.name is not None:
        plan.name = payload.name
        changes["name"] = payload.name
    if payload.description is not None:
        plan.description = payload.description
        changes["description"] = payload.description
    if payload.status is not None:
        plan.status = payload.status
        changes["status"] = payload.status
    if payload.price is not None:
        plan.price = payload.price
        changes["price"] = payload.price
    if payload.currency is not None:
        plan.currency = payload.currency
        changes["currency"] = payload.currency

    db.add(plan)
    db.commit()
    db.refresh(plan)

    record_audit(
        action="update_plan",
        user_id=str(user.id),
        entity_type="plan",
        entity_id=str(plan.id),
        changes=changes,
    )

    return SuccessResponse(data=plan_to_dict(plan))


@router.delete("/plan/{plan_id}", response_model=SuccessResponse)
def delete_plan(plan_id: UUID, db: Session = Depends(get_db), user=Depends(require_role("content_manager"))):
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    db.delete(plan)
    db.commit()

    record_audit(
        action="delete_plan",
        user_id=str(user.id),
        entity_type="plan",
        entity_id=str(plan.id),
        changes={"deleted": True},
    )

    return SuccessResponse(data={"deleted": True, "id": str(plan.id)})


@router.post("/plan", response_model=SuccessResponse)
def create_plan(payload: PlanCreate, db: Session = Depends(get_db), user=Depends(require_role("content_manager"))):
    existing = db.query(Plan).filter(Plan.code == payload.code).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plan code already exists")

    p = Plan(
        code=payload.code,
        name=payload.name,
        description=payload.description or "",
        price=payload.price,
        currency=payload.currency,
    )
    db.add(p)
    db.commit()
    db.refresh(p)

    record_audit(action="create_plan", user_id=str(user.id), entity_type="plan", entity_id=str(p.id), changes={"code": p.code})

    return SuccessResponse(data={"id": str(p.id), "plan": plan_to_dict(p)})
