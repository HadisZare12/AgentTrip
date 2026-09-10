# AgentTrip — Multi-Agent AI Travel Planner

AgentTrip plans a full trip end-to-end by handing the work to a team of specialist AI agents — flights, hotels, weather, and budget — coordinated by a supervisor, checked by an input guardrail, and reviewed by a human before anything is finalized.

> Plan a trip. Watch the agents work.

![App screenshot](docs/screenshot-app.png)

## How it works

1. **Guardrail** — every request is checked before anything runs. Off-topic or disallowed requests are rejected with a reason; nothing downstream executes.
2. **Supervisor Agent** — reads the approved request, decides which specialist agents are actually needed (e.g. "just flights and a hotel" skips the weather and budget agents), and extracts structured trip constraints (destination, origin, duration, budget, style).
3. **Specialist agents run in sequence**, each contributing to shared state:
   - **Flight Agent** — airport/airline lookups via the Aviationstack MCP server, summarized into flight guidance.
   - **Hotel Agent** — live web search via the Tavily MCP server for hotel options at the destination.
   - **Weather Agent** — current conditions and forecast via a custom OpenWeatherMap MCP server.
   - **Budget Agent** — cost breakdown based on the flight and hotel results.
4. **Itinerary Agent** drafts a day-by-day plan using everything gathered so far.
5. **Human-in-the-loop review** — the draft itinerary is presented for approval. You can approve it as-is, or leave feedback and have it redrafted and re-presented until you're satisfied.
6. **Trip Agent** assembles the final, polished plan once approved, ready to download.

![Architecture diagram](docs/architecture.png)

## Tech stack

- **Backend orchestration:** [LangGraph](https://github.com/langchain-ai/langgraph) — stateful multi-agent graph with conditional routing and native human-in-the-loop interrupts
- **LLM:** Groq (`openai/gpt-oss-20b`)
- **API layer:** FastAPI
- **Persistence:** PostgreSQL (via `langgraph-checkpoint-postgres`), so conversations and pending approvals survive restarts
- **External tools (MCP servers):**
  - [Tavily](https://tavily.com) — web search for hotels
  - [Aviationstack](https://aviationstack.com) — airport/airline data
  - Custom OpenWeatherMap MCP server — current weather + forecast
- **Frontend:** vanilla JS + HTML/CSS, no framework — talks to the backend over a small JSON API

## Project structure

```
AgentTrip/
├── app.py                     # FastAPI app: /api/trip, /api/trip/resume
├── backend.py                 # LangGraph graph: guardrail, supervisor, agents, HITL
├── mcp_client_local.py        # MCP client setup + per-server tool loading
├── custom_weather_mcp_server.py
├── static/
│   ├── js/app.js              # frontend logic + rendering
│   └── css/style.css
├── templates/
│   └── index.html
└── docs/
    ├── screenshot-app.png
    └── architecture.png
```

## Setup

### 1. Environment variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_key
TAVILY_API_KEY=your_tavily_key
AVIATION_STACK_API_KEY=your_aviationstack_key
OPENWEATHER_API_KEY=your_openweather_key
DATABASE_URL=postgresql://user:password@host:port/dbname
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Run

```bash
python app.py
```

The app runs at `http://127.0.0.1:8000`.

## Example

> "Plan a 6 day trip from Berlin to Paris — I just need the hotel and the flight."

The supervisor detects that only the flight and hotel agents are needed, skips weather and budget, and drafts an itinerary using just those two.

## Roadmap / known limitations

- The final itinerary prompt doesn't yet fully restrict its output sections to only the agents that were actually run
- Rate limiting on the LLM provider (Groq free tier) can occasionally slow down multi-agent requests

## License

MIT (or update to whatever license you're using)


