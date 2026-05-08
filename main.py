import asyncio
import json
from typing import Any
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from db import get_supabase_client
from supabase import Client


# Initialize FastAPI app
app = FastAPI(title="PinkVault Chat API", version="0.1.0")

# Initialize Supabase client at startup
supabase_client: Client = get_supabase_client()


class ConnectionManager:
    """Manage active WebSocket connections and broadcasting."""
    
    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []
    
    async def connect(self, websocket: WebSocket) -> None:
        """Accept and add a WebSocket connection."""
        await websocket.accept()
        self.active_connections.append(websocket)
    
    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection."""
        self.active_connections.remove(websocket)
    
    async def broadcast(self, message: str) -> None:
        """Send a message to all connected clients."""
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                # Connection might be closed, skip it
                pass


# Global connection manager instance
manager = ConnectionManager()


async def keep_alive(websocket: WebSocket) -> None:
    """
    Send periodic ping messages to keep the connection alive.
    Prevents load balancers from dropping idle connections.
    
    Runs an infinite loop that sends a ping JSON every 45 seconds.
    Exits cleanly on WebSocketDisconnect or RuntimeError.
    """
    try:
        while True:
            await asyncio.sleep(45)
            await websocket.send_json({"type": "ping"})
    except (WebSocketDisconnect, RuntimeError):
        # Connection closed or runtime error, exit cleanly
        pass


async def save_message(sender: str, encrypted_text: str) -> None:
    """
    Insert a message into the Supabase messages table.
    
    Args:
        sender: The sender's identifier.
        encrypted_text: The encrypted message text.
    """
    try:
        supabase_client.table("messages").insert({
            "sender": sender,
            "encrypted_text": encrypted_text
        }).execute()
    except Exception as error:
        print(f"Error saving message to database: {str(error)}")


@app.get("/health")
async def health_check() -> dict[str, str]:
    """
    Health check endpoint to verify the API is online.
    
    Returns:
        dict: Status response indicating the API is online.
    """
    return {"status": "online"}


async def fetch_chat_history() -> list[dict[str, Any]]:
    """
    Fetch chat history from the messages table in Supabase.
    
    Queries the messages table, orders by timestamp in ascending order,
    and returns the last 50 messages.
    
    Returns:
        list: List of message dictionaries from the database.
    
    Raises:
        Exception: Re-raises any database errors with context.
    """
    try:
        response = supabase_client.table("messages").select("*").order(
            "timestamp", desc=False
        ).limit(50).execute()
        return response.data if response.data else []
    except Exception as error:
        raise Exception(f"Failed to fetch chat history: {str(error)}")


@app.get("/history")
async def get_history() -> list[dict[str, Any]]:
    """
    Retrieve chat history from the database.
    
    Returns:
        list: Chat messages ordered by timestamp, limited to last 50 entries.
    
    Raises:
        HTTPException: If the database query fails.
    """
    try:
        history = await fetch_chat_history()
        return history
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving chat history: {str(error)}"
        )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for real-time chat communication.
    
    Handles connections, message broadcasting, and database persistence.
    Includes keep-alive mechanism to prevent connection timeouts.
    Accepts WebSocket connections and broadcasts received messages to all clients.
    """
    await manager.connect(websocket)
    
    # Start the keep-alive task
    keep_alive_task: asyncio.Task[None] = asyncio.create_task(
        keep_alive(websocket)
    )
    
    try:
        while True:
            # Wait for incoming messages from the client
            data = await websocket.receive_text()
            
            # Broadcast to all connected clients
            await manager.broadcast(data)
            
            # Parse sender and text from the message
            # Assuming the message is in format: {"sender": "...", "text": "..."}
            try:
                message_payload = json.loads(data)
                sender = message_payload.get("sender", "unknown")
                encrypted_text = message_payload.get("text", "")
                
                # Insert into database asynchronously without blocking the loop
                asyncio.create_task(save_message(sender, encrypted_text))
            except json.JSONDecodeError:
                # Invalid JSON, skip database insert
                pass
    
    except WebSocketDisconnect:
        # Handle client disconnect
        await manager.disconnect(websocket)
        keep_alive_task.cancel()
        try:
            await keep_alive_task
        except asyncio.CancelledError:
            pass
