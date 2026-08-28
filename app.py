from pathlib import Path
import traceback
import uvicorn

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse,HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel



from backend import run_trip_agent

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

        return JSONResponse(content={
            "success": True,
            "thread_id": result["thread_id"],
            "answer": result["final_output"],
            "flight_results": result["flight_results"],
            "hotel_results": result["hotel_results"],
            "itinerary": result["itinerary"],
            "llm_calls": result["llm_calls"]
        })
    except Exception as e:
        print("Error in /api/trip:", str(e))
        traceback.print_exc()   
        return JSONResponse(content={"error": str(e)}, status_code=500)
    
@app.get("/health")
async def health_check():
    return JSONResponse(content={"status": "ok"})

@app.get("/favicon.ico")
async def favicon():
    return JSONResponse(content={})


if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000,reload=True)