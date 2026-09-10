import os
import shutil
import sys
from pathlib import Path
from typing import Any

import certifi
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_mcp_adapters.client import MultiServerMCPClient


# =========================================================
# Environment setup
# =========================================================

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

# Support both environment-variable spellings.
AVIATION_STACK_API_KEY = (
    os.getenv("AVIATION_STACK_API_KEY")
    or os.getenv("AVIATIONSTACK_API_KEY")
)

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

WEATHER_SERVER_PATH = BASE_DIR / "custom_weather_mcp_server.py"
UVX_COMMAND = shutil.which("uvx") or "uvx"


def _require_env(name: str, value: str | None) -> str:
    """Return an environment value or raise a readable setup error."""
    if not value:
        raise RuntimeError(
            f"{name} is missing. Add {name}=your_key to the project .env file."
        )
    return value


def _subprocess_env(**updates: str | None) -> dict[str, str]:
    """Preserve the current environment and add MCP API keys on top."""
    env = os.environ.copy()
    for key, value in updates.items():
        if value:
            env[key] = value
    return env


# =========================================================
# LLM
# =========================================================
# NOTE: "llama-3.3-70b-versatile" is deprecated on Groq as of mid-2026.
# Using the current recommended replacement instead.
llm = ChatGroq(
    model="openai/gpt-oss-20b",
    api_key=_require_env("GROQ_API_KEY", GROQ_API_KEY),
)


# =========================================================
# MCP client
# =========================================================

client = MultiServerMCPClient(
    {
        "tavily": {
            "transport": "streamable_http",
            "url": (
                "https://mcp.tavily.com/mcp/"
                f"?tavilyApiKey={TAVILY_API_KEY or ''}"
            ),
        },

        "aviationstack": {
            "transport": "stdio",
            "command": UVX_COMMAND,
            "args": [
                "--with", "mcp<2",   # pin: aviationstack-mcp still targets mcp 1.x's FastMCP API
                "aviationstack-mcp",
            ],
            "env": _subprocess_env(
                AVIATION_STACK_API_KEY=AVIATION_STACK_API_KEY,
            ),
        },

        "weather": {
            "transport": "stdio",
            "command": "/opt/anaconda3/envs/travel/bin/python",
            "args": [
                "/Users/hadis/Desktop/Agents_project/AgentTrip/custom_weather_mcp_server.py"
            ],
            "env": _subprocess_env(
                OPENWEATHER_API_KEY=OPENWEATHER_API_KEY,
            ),
        },
    }
)


async def _get_server_tool(server_name: str, tool_name: str):
    """
    Load one tool from one MCP server.

    Scoping the lookup to a single server (rather than client.get_tools()
    across all servers) means a broken weather or AviationStack server
    can't crash an unrelated Tavily request, and vice versa.
    """
    if server_name == "tavily":
        _require_env("TAVILY_API_KEY", TAVILY_API_KEY)

    elif server_name == "aviationstack":
        _require_env("AVIATION_STACK_API_KEY", AVIATION_STACK_API_KEY)
        if shutil.which("uvx") is None:
            raise RuntimeError(
                "uvx was not found. Install uv, reopen the terminal, "
                "activate the travel environment, and run `uvx --version`."
            )

    elif server_name == "weather":
        _require_env("OPENWEATHER_API_KEY", OPENWEATHER_API_KEY)
        if not WEATHER_SERVER_PATH.is_file():
            raise FileNotFoundError(
                f"Weather MCP server not found: {WEATHER_SERVER_PATH}"
            )

    tools = await client.get_tools(server_name=server_name)

    tool = next((item for item in tools if item.name == tool_name), None)

    if tool is None:
        available_tools = ", ".join(sorted(item.name for item in tools)) or "none"
        raise RuntimeError(
            f"MCP tool '{tool_name}' was not found on server '{server_name}'. "
            f"Available tools: {available_tools}"
        )

    return tool


# =========================================================
# MCP connection test
# =========================================================

async def get_all_tools() -> None:
    """Test every MCP server independently. One failed server won't stop the rest."""
    for server_name in ("tavily", "aviationstack", "weather"):
        try:
            tools = await client.get_tools(server_name=server_name)
            tool_names = ", ".join(tool.name for tool in tools) or "no tools"
            print(f"{server_name}: OK -> {tool_names}")
        except Exception as exc:
            print(f"{server_name}: FAILED -> {type(exc).__name__}: {exc}")


# =========================================================
# Tavily MCP
# =========================================================

async def tavily_mcp_serach(query: str):
    """Note: kept this exact (misspelled) name because backend.py imports it as-is.
    Consider renaming both here and in backend.py to `tavily_mcp_search` when convenient."""
    search_tool = await _get_server_tool("tavily", "tavily_search")
    return await search_tool.ainvoke({"query": query})


# =========================================================
# AviationStack MCP
# =========================================================

async def aviation_mcp_call(tool_name: str, tool_args: dict[str, Any] | None = None):
    aviation_tool = await _get_server_tool("aviationstack", tool_name)
    return await aviation_tool.ainvoke(tool_args or {})


# =========================================================
# Weather MCP
# =========================================================

async def weather_mcp_search(city: str):
    weather_tool = await _get_server_tool("weather", "get_current_weather")
    return await weather_tool.ainvoke({"city": city})


async def forecast_mcp_search(city: str):
    forecast_tool = await _get_server_tool("weather", "get_forecast")
    return await forecast_tool.ainvoke({"city": city})


# =========================================================
# Destination extractor
# =========================================================

def extract_destination_from_query(query: str) -> str:
    """Note: kept this name because backend.py imports it as-is."""
    prompt = f"""
Extract only the destination city or country from the travel request.

Travel request:
{query}

Return only the destination name.
Do not add any explanation. If no destination is found, return "Unknown".
"""
    response = llm.invoke(prompt)
    destination = str(response.content).strip()

    if not destination:
        return "Unknown"

    return destination