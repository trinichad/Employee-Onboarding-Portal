from fastapi import APIRouter

from app.api.v1 import admin, auth, branding, config, employees, forms, me, orgs, requests as requests_router, resources, users

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(config.router)
api_router.include_router(branding.router)
api_router.include_router(admin.router)
api_router.include_router(orgs.router)
api_router.include_router(users.router)
api_router.include_router(forms.router)
api_router.include_router(resources.router)
api_router.include_router(employees.router)
api_router.include_router(requests_router.router)
