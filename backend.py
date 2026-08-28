import os
import re
import certifi
from dotenv import load_dotenv

load_dotenv()

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

from typing import TypedDict, Annotated
import operator
import uuid

import psycopg
from psycopg.rows import dict_row

from langgraph.graph import StateGraph,START,END
from langgraph.checkpoint.postgres import PostgresSaver


from langchain_core.messages import (AnyMessage, HumanMessage, SystemMessage, AIMessage)
from langchain_groq import ChatGroq
from tools.tavily_tool import tavilly_search
from tools.flight_tool import search_flights

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

llm = ChatGroq(api_key=GROQ_API_KEY, model="openai/gpt-oss-120b")


# =======================
# State
# =======================
class TripState(TypedDict):
    messages:Annotated[list[AnyMessage], operator.add]
    user_query:str
    flight_results:str
    hotel_results:str
    itinerary:str
    llm_calls:int

# =======================
# Flight Agent
# =======================
def flight_agent(state:TripState):
    """
    Flight agent that searches for flights based on the user's query.

    Args:
        state (TripState): The current state of the trip.
    """
    user_query = state["user_query"]
    flight_results = search_flights(user_query)
    return {
        "flight_results": flight_results,
        "messages": [
            AIMessage(content="Flight results Fetched!")
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }
def hotel_agent(state:TripState):
    """
    Hotel agent that searches for hotels based on the user's query.

    Args:
        state (TripState): The current state of the trip.
    """
    user_query = f"Best Hotels in {state['user_query']}"
    hotel_results = tavilly_search(user_query)
    return {
        "hotel_results": hotel_results,
        "messages": [
            AIMessage(content="Hotel results Fetched!")
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
    
    itinerary_prompt = f"""
    Create a detailed travel itinerary for the following user query: "{user_query}". Use the provided flight and hotel results to inform the itinerary.
    User Query: {user_query}
    
    Flight Results: {flight_results}
    
    Hotel Results: {hotel_results}
    
    Make the ininerary practical, budget-aware, and efficient. Provide a day-by-day breakdown of activities, including travel times, sightseeing, and dining options. Ensure the itinerary is feasible and enjoyable for the user.
    """
    
    response= llm.invoke([
        SystemMessage(content="You are a travel agent that creates detailed travel itineraries based on user queries, flight results, and hotel results."),
        HumanMessage(content=itinerary_prompt)
    ])
    
    return {
        "itinerary": response.content,
        "messages": [
            response
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
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
    final_prompt = f"""
    You are a travel agent that creates detailed travel itineraries based on user queries, flight results, and hotel results. Your task is to generate a complete travel plan for the user.
    User Query: {state['user_query']}
    Flight Results: {state['flight_results']}
    Hotel Results: {state['hotel_results']}
    Itinerary: {state['itinerary']}
    Format the final answer using these sections: 
    "User Query", 
    "Flight Results", 
    "Hotel Results", 
    "Itinerary",
    "Estimated Budget" should be included if possible.
    Ensure the itinerary is practical, budget-aware, and efficient. 
    Provide a day-by-day breakdown of activities, including travel times, sightseeing, and dining options. 
    Ensure the itinerary is feasible and enjoyable for the user.
    """

    response= llm.invoke([
        SystemMessage(content="You are a travel agent that creates detailed travel itineraries based on user queries, flight results, and hotel results."),
        HumanMessage(content=final_prompt)
    ])
    return {
        "messages": [
            response
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }
#=======================
# Build the state graph
#=======================
graph = StateGraph(TripState)

graph.add_node("flight_agent", flight_agent)
graph.add_node("hotel_agent", hotel_agent)
graph.add_node("itinerary_agent", itinerary_agent)
graph.add_node("trip_agent", trip_agent)


graph.add_edge(START, "flight_agent")
graph.add_edge("flight_agent", "hotel_agent")
graph.add_edge("hotel_agent", "itinerary_agent")
graph.add_edge("itinerary_agent", "trip_agent")
graph.add_edge("trip_agent", END)

#=======================
# Postgres checkpointing
#=======================
DATABASE_URL = get_db_url()
_conn = psycopg.connect(DATABASE_URL,autocommit=True, row_factory=dict_row)

checkpointer = PostgresSaver(_conn)
checkpointer.setup()

travel_graph = graph.compile(checkpointer=checkpointer)

#======================
# FAST API
#======================
def run_trip_agent(user_input:str,thread_id:str=None):
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
        "flight_results":"",
        "hotel_results":"",
        "itinerary":"",
        "llm_calls":0
    }, config=config)

    final_output = result["messages"][-1].content

    return {
        "thread_id": thread_id,
        "final_output": final_output,
        "flight_results": result.get("flight_results", ""),
        "hotel_results": result.get("hotel_results", ""),
        "itinerary": result.get("itinerary", ""),
        "llm_calls": result.get("llm_calls", 0)
    }
 