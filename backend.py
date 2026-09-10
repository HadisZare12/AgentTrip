import os
import re
import certifi
from dotenv import load_dotenv

load_dotenv()

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

from typing import TypedDict, Annotated,Any
import operator
import uuid
import json
import psycopg
from psycopg.rows import dict_row

from langgraph.graph import StateGraph,START,END
from langgraph.types import Command,interrupt

from langgraph.checkpoint.postgres import PostgresSaver


from langchain_core.messages import (AnyMessage, HumanMessage, SystemMessage, AIMessage)
from langchain_groq import ChatGroq
#from tools.tavily_tool import tavilly_search
from mcp_client import tavily_mcp_search
import asyncio
#from tools.flight_tool import search_flights
from mcp_client_local import tavily_mcp_serach,aviation_mcp_call,extract_destination_from_query,weather_mcp_search,forecast_mcp_search


def get_db_url():
    """
    Get the database URL.

    Returns:
        str: The database URL.
    """
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL environment variable is not set.")
    if "sslmode" not in database_url:
        separator = '&' if '?' in database_url else '?'
        database_url = f"{database_url}{separator}sslmode=require"
    return database_url

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY environment variable is not set.")

# =======================
# LLM
# =======================

llm = ChatGroq(api_key=GROQ_API_KEY, model="openai/gpt-oss-20b")


# =======================
# State
# =======================
class TripState(TypedDict):
    messages:Annotated[list[AnyMessage], operator.add]
    user_query:str

    #supervisor and guardrail state
    guardrail_allowed: bool
    guardrail_reason: str
    selected_agents: list[str]
    trip_constraints: dict[str, Any]
    supervisor_reasoning: str

    flight_results:str
    hotel_results:str
    weather_results:dict
    itinerary:str
   

    #new budget + HITL state
    budget_results:str
    approval_request:str
    approved:bool
    human_feedback:str
    final_response:str

    llm_calls:int

#========================
# shared helpers
#===========================

KNOWN_AGENTS = {
    "flight_agent",
    "hotel_agent",
    "weather_agent",
    "budget_agent",
    "itinerary_agent"
}

AGENT_ORDER = [
     "flight_agent",
        "hotel_agent",
        "weather_agent",
        "budget_agent",
        "itinerary_agent"

]
def _llm_text(system_prompt:str, user_prompt:str)->str:
    response = llm.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt)
    ])
    return str(response.content)

def _json_from_llm(text:str) -> dict[str, Any]:

    start = text.find("{")
    end = text.rfind("}") 

    if start == -1 or end == -1 or end < start:
        raise ValueError("No JSON found in the provided text.")
    return json.loads(text[start:end+1])
def _empty_constarints() -> dict[str, Any]:
    return {
        "destination":"",
        "origin":"",
        "duration":"",
        "budget":"",
        "travel_style":"",
        "special_preferences":[]
    }

#========================
# supervisor agent + Input guardrails
# =======================

def supervisor_agent(state:TripState):
    """
    Supervisor agent that evaluates the user's query and determines which agents to invoke.

    Args:
        state (TripState): The current state of the trip.
    """
    user_query = state["user_query"]
    llm_calls = state.get("llm_calls", 0)

    guardrail_prompt = f"""
    Determine wheather the following request belongs to the travel domain and if it adheres to the travel constraints and guidelines. 
    If it does, select the appropriate agents to invoke. If not, provide a reason for rejection.
    Valid requests should be related to travel planning, including but not limited to: flight booking, hotel reservations, itinerary planning, weather information, and budget considerations.
    Block clearly unrelated requests and requests asking for illegal or unethical activities.Do not block a valid request merely because some details are missing.
    return strict JSON only:
    {{
        "allowed":true,
        "reason":""
    }}
    user request:
    {user_query}
    """

    try:
        guardrail_raw = _llm_text("You are the input guardrail for a travel-palnning application.Return strict JSON only", guardrail_prompt)

        guardrail_result = _json_from_llm(guardrail_raw)
        allowed = bool(guardrail_result.get("allowed",True))
        guardrail_reason = str(guardrail_result.get("reason","")).strip()
        llm_calls += 1
    except Exception as e:
        print(f"Guardrail fallback used: {e}")
        allowed = True
        guardrail_reason = "Guardrail evaluation failed, defaulting to allowed."

    if not allowed:
        reason = guardrail_reason or (
                "Agent Travel AI can only help with travel-planning requests."
                "Please ask about a destination, flight, hotel,weather,budget, or itinerary."
        )
        return{
                "guardrail_allowed":False,
                "guardrail_reason":reason,
                "selected_agents":[],
                "trip_constraints":_empty_constarints(),
                "supervisor_reasoning":reason,
                "final_response":reason,
                "message":[
                    AIMessage(content=f"Guardrail blocked the request: {reason}")
                ],
                "llm_calls":llm_calls
        }
    supervisor_prompt = f"""    
            you are a travel planning supervisor agent. Based on the user query, determine which agents should be invoked and extract any relevant trip constraints.

            Available Agents:
            1. flight_agent: Handles flight-related queries, including booking and information.
            2. hotel_agent: Manages hotel bookings and information.
            3. weather_agent: Provides current weather and forecasts for destinations.
            4. budget_agent: Assesses the budget for the trip and provides cost estimates.
            5. itinerary_agent: Creates detailed travel itineraries based on user queries, flight results
            return strict JSON only using the following format:
            {{
                "selected_agents": ["flight_agent", "hotel_agent", "weather_agent", "budget_agent", "itinerary_agent"],
                "trip_constraints": {{
                    "destination": "string",
                    "origin": "string",
                    "duration": "string",
                    "budget": "string", 
                    "travel_style": "string",
                    "special_preferences": ["string"]
                }},
                "supervisor_reasoning": "string"
            }}
            User Query:
            {user_query}        

        """ 
    try:
            supervisor_raw = _llm_text("You are the travel planning supervisor agent. Return strict JSON only.",supervisor_prompt)
            parsed = _json_from_llm(supervisor_raw)
            requested_agents = parsed.get("selected_agents", [])
            selected_agents = [name for name in AGENT_ORDER if name in requested_agents and name in KNOWN_AGENTS]
            if "itinerary_agent" not in selected_agents:
                selected_agents.append("itinerary_agent")
            constraints= _empty_constarints()
            parsed_constraints = parsed.get("trip_constraints", {})
            if isinstance(parsed_constraints, dict):
                constraints.update(parsed_constraints)
            reasoning = str(parsed.get("reasoning","")).strip()
            llm_calls += 1
    except Exception as e:
            print(f"Supervisor fallback used: {e}")
            selected_agents = AGENT_ORDER.copy()
            constraints = _empty_constarints()
            reasoning = "Supervisor evaluation failed, defaulting to all agents."
    return {
            "guardrail_allowed":True,
            "guardrail_reason":guardrail_reason,
            "selected_agents":selected_agents,
            "trip_constraints":constraints,
            "supervisor_reasoning":reasoning,
            "message":[
                AIMessage(content="Supervisor agent evaluated the request and selected agents.")
            ],
            "llm_calls":llm_calls
    }
#===========================
# Guardrail blocked response
#==============================
def guardrail_blocked_agent(state:TripState):
    """
    Guardrail blocked agent that returns a message indicating the request was blocked by the guardrail.

    Args:
        state (TripState): The current state of the trip.
    """
    reason = state.get("final_response") or state.get("guardrail_reason") or ("This request was blocked by the travel input guardrail.")
    return {
        "final_response": reason,
        "message": [
            AIMessage(content=f"Guardrail blocked the request: {reason}")
        ]
    }
#========================          
# Flight Agent
# =======================

FLIGHT_AGENT_PROMPT = """
You are a travel flight expert.

User Query:
{query}

Airport Information:
{airport_data}

Airline Information:
{airline_data}

Generate:

1. Likely departure airport
2. Likely arrival airport
3. Airlines serving this route
4. Typical flight duration
5. Estimated airfare range
6. Peak season pricing warning
7. Booking advice

Return concise travel guidance.
"""
#FLIGHT AGENT
def flight_agent(state:TripState):
    print("INSIDE FLIGHT AGENT")

    query = state["user_query"]

    try:
        airports = asyncio.run(
            aviation_mcp_call(
                "list_airports"
            )
        )

        airlines = asyncio.run(
            aviation_mcp_call(
                "list_airlines"
            )
        )
        print("AIrports:",airports)
        print("Airlines:",airlines)

        prompt = FLIGHT_AGENT_PROMPT.format(
            query=query,
            airport_data = str(airports)[:3000],
            airline_data=str(airlines)[:3000]

        )
        response = llm.invoke([
            SystemMessage(
                content = "You are an expert travel flight planner."
            ),
            HumanMessage(content=prompt)
        ])

        flight_data = response.content
    except Exception as e:
        flight_data = f"Flight information unavialable:{(e)}"

    return {
        "flight_results":flight_data,
        "message":[
            AIMessage(
                content= "Flight recommendation generated"
            )
        ],
        "llm_calls":state.get("llm_calls",0) + 1
    }

def hotel_agent(state:TripState):
    """
    Hotel agent that searches for hotels based on the user's query.

    Args:
        state (TripState): The current state of the trip.
    """
    destination = extract_destination_from_query(state["user_query"])
    search_query = f"Best hotels in {destination}" if destination != "Unknown" else f"Best hotels for: {state['user_query']}"
    hotel_results = asyncio.run(tavily_mcp_search(search_query))
    return {
        "hotel_results": hotel_results,
        "messages": [
            AIMessage(content="Hotel results Fetched!")
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }

#=======================
# Weather Agent
#=======================
def weather_agent(state:TripState):
    """
    Weather agent that fetches current weather and forecast based on the user's query.

    Args:
        state (TripState): The current state of the trip.
    """
    destination = extract_destination_from_query(state["user_query"])
    if destination == "Unknown":
        return {
            "messages": [
                AIMessage(content="Could not extract destination for weather information.")
            ],
            "llm_calls": state.get("llm_calls", 0) + 1
        }

    current_weather = asyncio.run(weather_mcp_search(destination))
    forecast = asyncio.run(forecast_mcp_search(destination))

    return {
        "weather_results": {
            "current_weather": current_weather,
            "forecast": forecast
        },
        "messages": [
            AIMessage(content="Weather information fetched!")
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }

#=======================
# Budget Agent
#=======================
def budget_agent(state:TripState):

    user_query = state["user_query"]
    flight_results = state["flight_results"]
    hotel_results = state["hotel_results"]

    budget_prompt = f"""
    Estimate the budget for the following travel request based on the provided flight and hotel results.
    
    User Query: {user_query}
    
    Flight Results: {flight_results}
    
    Hotel Results: {hotel_results}
    
    Provide a detailed breakdown of estimated costs, including flights, accommodation, meals, transportation, and any other relevant expenses. Return the total estimated budget in the destination currency if is possible.
    """

    response = llm.invoke([
        SystemMessage(content="You are a travel budget expert."),
        HumanMessage(content=budget_prompt)
    ])

    return {
        "budget_results": response.content,
        "messages": [
            AIMessage(content="Budget estimation generated.")
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }
# =======================
# Itinerary Agent 
# =======================
def itinerary_agent(state:TripState):
    """
    Itinerary agent that generates an itinerary based on the user's query, flight results, and hotel results.

    Args:
        state (TripState): The current state of the trip.
    """
    user_query = state["user_query"]
    flight_results = state["flight_results"]
    hotel_results = state["hotel_results"]
    weather_results = state.get("weather_results", {})
    trip_constraints = state.get("trip_constraints", {})
    budget_results = state.get("budget_results", "")
    
    itinerary_prompt = f"""
    Create a detailed travel itinerary for the following user query: "{user_query}". Use the provided flight and hotel results to inform the itinerary.
    User Query: {user_query}

    Trip Constraints:{trip_constraints}
    
    Flight Results: {flight_results}
    
    Hotel Results: {hotel_results}

    Weather Results: {weather_results}

    Budget Results: {budget_results}
    
    Make the ininerary practical, budget-aware, and efficient. Provide a day-by-day breakdown of activities, including travel times, sightseeing, and dining options. Ensure the itinerary is feasible and enjoyable for the user.
    """
    
    response= llm.invoke([
        SystemMessage(content="You are a travel agent that creates detailed travel itineraries based on user queries, flight results, and hotel results."),
        HumanMessage(content=itinerary_prompt)
    ])

    approval_request = (
        "Please review the generated draft itinerary and provide your approval or feedback. If you approve, we will proceed to finalize the itinerary. "
        "If you have any suggestions or changes, please specify them."
    )
    
    return {
        "itinerary": response.content,
        "approval_request": approval_request,
        "messages": [
            response
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }

#================================
# Human In the Loop
#===============================
def human_approval_agent(state:TripState):
    #do not wrap interupt() in try/except, LangGraph uses it to pause execution.

    review = interrupt(
        {
            "question":"Do you approve the draft itinerary? Please provide your approval or feedback.",
            "draft_itinerary":state.get("itinerary",""),
            "approval_request":state.get("approval_request",""),
            "selected_agents":state.get("selected_agents",[]),
            "supervisor_reasoning":state.get("supervisor_reasoning",""),
            "expected_response":{
                "approved":True,
                "feedback":"Optional revision feedback"
            }

        }
    )
    approved = bool(review.get("approved", False))
    human_feedback = str(review.get("feedback", "")).strip()
    return {
        "approved": approved,
        "human_feedback": human_feedback,
        "messages": [AIMessage(content="Human approval received.")]
    }  
# =======================
# Final Agent that orchestrates the flight, hotel, and itinerary agents
# =======================
def trip_agent(state:TripState):
    """
    Trip agent that orchestrates the flight, hotel, and itinerary agents to create a complete travel plan.

    Args:
        state (TripState): The current state of the trip.
    """
    if state.get("approved", False):
        review_instruction = ("The draft itinerary has been approved by the user. Please finalize the itinerary and provide any additional recommendations or tips for the trip.")
    else:
        review_instruction = f"""
            The draft itinerary has not been approved by the user. Please consider the following feedback and revise the itinerary accordingly: {state.get('human_feedback', 'No feedback provided.')}"""
    final_prompt = f"""
    You are a travel agent that creates detailed travel itineraries based on user queries, flight results, and hotel results. Your task is to generate a complete travel plan for the user.
    Human Review Instruction: {review_instruction}
    User Query: {state['user_query']}
    Suggested Trip Constraints: {state.get('trip_constraints', {})}
    Flight Results: {state['flight_results']}
    Hotel Results: {state['hotel_results']}
    Weather Results: {state.get('weather_results', {})}
    Budget Results: {state.get('budget_results', '')}
    Itinerary: {state['itinerary']}
    Format the final answer using these sections: 
    "User Query", 
    "Flight Results", 
    "Hotel Results", 
    "Weather Results",
    "Itinerary",
    "Estimated Budget" should be included if possible.
    Ensure the itinerary is practical, budget-aware, and efficient. 
    Provide a day-by-day breakdown of activities, including travel times, sightseeing, and dining options. 
    Ensure the itinerary is feasible and enjoyable for the user.
    Incorporate any feedback provided by the user and make necessary adjustments to the itinerary.
    """

    response= llm.invoke([
        SystemMessage(content="You are a travel agent that creates detailed travel itineraries based on user queries, flight results, and hotel results."),
        HumanMessage(content=final_prompt)
    ])
    return {
        "final_response": response.content,
        "messages": [
            response
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }
#=========================
# Dynamic Supervisor Routing
#==========================
ROUTE_MAP = {
    "guardrail_blocked": "guardrail_blocked",
    "flight_agent": "flight_agent",
    "hotel_agent": "hotel_agent",
    "weather_agent": "weather_agent",
    "budget_agent":"budget_agent",
    "itinerary_agent": "itinerary_agent"
}
def _selected_agents(state:TripState) -> list[str]:
   selected = state.get("selected_agents", [])
   return [agent for agent in AGENT_ORDER if agent in selected]

def route_from_supervisor(state:TripState) -> str:
    """
    Determine the next agent to invoke based on the supervisor's evaluation.

    Args:
        state (TripState): The current state of the trip.

    Returns:
        str: The name of the next agent to invoke.
    """
    if not state.get("guardrail_allowed", True):
        return "guardrail_blocked"
    
    selected= _selected_agents(state)
    return selected[0] if selected else "itinerary_agent"

def route_after_agent(current_agent:str):
    def route(state:TripState) -> str:
        selected = _selected_agents(state)
        current_index = AGENT_ORDER.index(current_agent)

        for next_agent in AGENT_ORDER[current_index + 1:]:
            if next_agent in selected:
                return next_agent
      
        return "itinerary_agent"
    return route

#=======================
# Build the state graph
#=======================
graph = StateGraph(TripState)
graph.add_node("supervisor_agent", supervisor_agent)
graph.add_node("guardrail_blocked", guardrail_blocked_agent)
graph.add_node("flight_agent", flight_agent)
graph.add_node("hotel_agent", hotel_agent)
graph.add_node("weather_agent", weather_agent)
graph.add_node("itinerary_agent", itinerary_agent)
graph.add_node("budget_agent", budget_agent)
graph.add_node("human_approval_agent", human_approval_agent)
graph.add_node("trip_agent", trip_agent)



graph.add_edge(START, "supervisor_agent")
graph.add_conditional_edges("supervisor_agent", route_from_supervisor,ROUTE_MAP)
graph.add_conditional_edges("flight_agent", route_after_agent("flight_agent"), ROUTE_MAP)
graph.add_conditional_edges("hotel_agent", route_after_agent("hotel_agent"), ROUTE_MAP)
graph.add_conditional_edges("weather_agent", route_after_agent("weather_agent"), ROUTE_MAP)
graph.add_conditional_edges("budget_agent", route_after_agent("budget_agent"), ROUTE_MAP)   

graph.add_edge("itinerary_agent", "human_approval_agent")
graph.add_edge("human_approval_agent", "trip_agent")
graph.add_edge("trip_agent", END)
graph.add_edge("guardrail_blocked", END)


#=======================
# Postgres checkpointing
#=======================
from psycopg_pool import ConnectionPool

DATABASE_URL = get_db_url()

_pool = ConnectionPool(
    conninfo=DATABASE_URL,
    min_size=1,
    max_size=10,
    kwargs={"autocommit": True, "row_factory": dict_row},
)

checkpointer = PostgresSaver(_pool)
checkpointer.setup()

travel_graph = graph.compile(checkpointer=checkpointer)

#======================
# FAST API
#======================
def _interupt_payload(result:dict[str,Any]) -> dict[str,Any] | None:
    interrupts = result.get("__interrupt__", [])
    if not interrupts:
        return None
    first_interrupt = interrupts[0]
    payload = getattr(first_interrupt, "value", first_interrupt)
    return payload if isinstance(payload, dict) else{"value":payload}
def _serialize_result(result:dict[str,Any],thread_id:str) -> dict[str,Any]:
    messages = result.get("messages", [])
    last_message = messages[-1].content if messages else ""
    answer = result.get("final_response") or last_message
    interupt_payload = _interupt_payload(result)
    if interupt_payload:
        answer = interupt_payload.get("draft_itinerary") or result.get("itinerary","")
    return {
        "thread_id": thread_id,"answer":answer,
        "require_approval":interupt_payload is not None,
        "approval_request":(interupt_payload.get("approval_request","") if interupt_payload else result.get("approval_request","")),
        "flight_results":result.get("flight_results",""),
        "hotel_results":result.get("hotel_results",""),
        "weather_results":result.get("weather_results",{}),
        "budget_results":result.get("budget_results",""),
        "itinerary": result.get("itinerary", ""),
        "selected_agents":result.get("selected_agents",[]),
        "trip_constraints":result.get("trip_constraints",{}),
        "supervisor_reasoning":result.get("supervisor_reasoning",""),
        "guardrail_allowed":result.get("guardrail_allowed",True),
        "guardrail_reason":result.get("guardrail_reason",""),
        "approved":result.get("approved"),
        "human_feedback":result.get("human_feedback",""),
        "llm_calls":result.get("llm_calls",0)
    }

def run_trip_agent(user_input:str,thread_id:str | None = None):

    """
    Run the trip agent with the given user input.

    Args:
        user_input (str): The user's travel query.

    Returns:
        dict: The final output from the trip agent.
    """
    if not thread_id:
        thread_id = f"user_{uuid.uuid4().hex}"

    config ={
        "configurable":{
            "thread_id":thread_id
        }
    }
    result = travel_graph.invoke({
        "messages":[HumanMessage(content=user_input)],
        "user_query":user_input,
        "guardrail_allowed":True,
        "guardrail_reason":"",
        "selected_agents":[],
        "trip_constraints":_empty_constarints(),
        "supervisor_reasoning":"",
        "flight_results":"",
        "hotel_results":"",
        "weather_results":{},
        "budget_results":"",
        "itinerary":"",
        "approval_request":"",
        "approved":False,
        "human_feedback":"",
        "final_response":"",
        "llm_calls":0
    }, config=config)

    
    print("RESULT KEYS:", list(result.keys()))
    print("HAS __interrupt__:", "__interrupt__" in result)
    print("__interrupt__ VALUE:", result.get("__interrupt__"))

    return _serialize_result(result, thread_id)
def resume_trip_agent(thread_id:str,approval:bool, feedback:str | None = None):

    if not thread_id:
        raise ValueError("thread_id is required to resume the trip agent.")
    config ={
        "configurable":{
            "thread_id":thread_id
        }
    }
    result = travel_graph.invoke(Command(resume={"approved":approval, "feedback":feedback.strip()}), config=config)
    return _serialize_result(result, thread_id)
 