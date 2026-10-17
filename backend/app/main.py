import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from .core.config import settings
from .core.errors import make_error_response, ErrorCodes
from .database.connection import init_db

app = FastAPI(
    title="EDITH AI OS",
    description="Enhanced Digital Intelligence & Tactical Helper",
    version="1.0.0"
)

# CORS restriction
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return make_error_response(
        422,
        ErrorCodes.VALIDATION_ERROR,
        "Empty, too long (over MAX_MESSAGE_CHARS) or malformed input."
    )

@app.get("/api/health")
def get_health():
    return {"status": "ok"}
