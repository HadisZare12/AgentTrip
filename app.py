from pathlib import Path
import traceback
import uvicorn

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
# allow nested events loops for async calls in FastAPI
import nest_asyncio
nest_asyncio.apply()


from backend import run_trip_agent, resume_trip_agent

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="AI Travel Agent",
    description="An AI-powered travel agent that helps you plan your trips, find flights and hotels, and create itineraries.",
    version="1.0.0",
)

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


class TripRequest(BaseModel):
    message: str
    thread_id: str | None = None


class ResumeRequest(BaseModel):
    thread_id: str
    approved: bool
    feedback: str | None = None


def _build_response(result: dict) -> dict:
    """Shared serializer so /api/trip and /api/trip/resume always return the same shape."""
    return {
        "success": True,
        "thread_id": result["thread_id"],
        "answer": result["answer"],
        "require_approval": result.get("require_approval", False),
        "approval_request": result.get("approval_request", ""),
        "flight_results": result.get("flight_results", ""),
        "hotel_results": result.get("hotel_results", ""),
        "weather_results": result.get("weather_results", {}),
        "budget_results": result.get("budget_results", ""),
        "itinerary": result.get("itinerary", ""),
        "llm_calls": result.get("llm_calls", 0),
        "guardrail_allowed": result.get("guardrail_allowed", True),
        "guardrail_reason": result.get("guardrail_reason", ""),
        "selected_agents": result.get("selected_agents", []),
        "supervisor_reasoning": result.get("supervisor_reasoning", ""),
        "approved": result.get("approved"),
        "human_feedback": result.get("human_feedback", ""),
    }


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={}
    )


@app.post("/api/trip")
async def trip(request: TripRequest):
    try:
        user_input = request.message.strip()
        if not user_input:
            return JSONResponse(content={"error": "Empty input"}, status_code=400)

        result = run_trip_agent(user_input=user_input, thread_id=request.thread_id)
        return JSONResponse(content=_build_response(result))

    except Exception as e:
        print("Error in /api/trip:", str(e))
        traceback.print_exc()
        return JSONResponse(content={"error": str(e)}, status_code=500)


@app.post("/api/trip/resume")
async def trip_resume(request: ResumeRequest):
    try:
        result = resume_trip_agent(
            thread_id=request.thread_id,
            approval=request.approved,
            feedback=request.feedback
        )
        return JSONResponse(content=_build_response(result))

    except Exception as e:
        print("Error in /api/trip/resume:", str(e))
        traceback.print_exc()
        return JSONResponse(content={"error": str(e)}, status_code=500)


@app.get("/health")
async def health_check():
    return JSONResponse(content={"status": "ok"})


@app.get("/favicon.ico")
async def favicon():
    return JSONResponse(content={})


if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)