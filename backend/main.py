from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.config.settings import settings
from app.routes.agent import include_agent_routes


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    include_agent_routes(app)

    @app.get("/health")
    async def health():
        return JSONResponse({"status": "ok"})

    return app


app = create_app()

