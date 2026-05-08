"""PinkVault backend module.

Architecture: FastAPI application serving API routes and WebSocket endpoints,
backed by Supabase for persistent message storage. The app exposes HTTP
endpoints for health and chat history, and a WebSocket endpoint for real-time
chat. Designed for deployment with backend on Render and static frontend on
Netlify.

Components:
    - FastAPI app with CORS enabled for frontend origins
    - Supabase client via environment configuration
    - WebSocket connection manager handling multiple clients
"""

import asyncio
import json
import os
from contextlib import suppress
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from db import get_supabase_client
from supabase import Client


# Initialize FastAPI app
app = FastAPI(title="PinkVault Chat API", version="0.1.0")

# CORS middleware: adjust allow_origins to Netlify URL in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Supabase client at startup
supabase_client: Client = get_supabase_client()

# Allowed usernames are configured through the environment.
ALLOWED_USERS: list[str] = [
    user.strip().lower()
    for user in os.getenv("ALLOWED_USERS", "").split(",")
    if user.strip()
]


class ConnectionManager:
    """Manage active WebSocket connections and broadcasting.

    Attributes:
        active_connections: A list of accepted WebSocket connections.
    """

    def __init__(self) -> None:
        """Initialize the connection registry.

        Returns:
            None
        """
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        """Accept and register a WebSocket connection.

        Args:
            websocket: The incoming WebSocket connection.

        Returns:
            None

        Raises:
            RuntimeError: Propagates WebSocket accept failures.
        """
        await websocket.accept()
        self.active_connections.append(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection if it is tracked.

        Args:
            websocket: The WebSocket connection to remove.

        Returns:
            None
        """
        await asyncio.sleep(0)
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str) -> None:
        """Send a text message to every connected client.

        Args:
            message: The serialized message payload to broadcast.

        Returns:
            None

        Raises:
            RuntimeError: Propagates send failures from individual sockets.
        """
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                # Connection might be closed, skip it
                pass


# Global connection manager instance
manager = ConnectionManager()

async def keep_alive(websocket: WebSocket) -> None:
    """Send periodic ping messages to keep a WebSocket alive.

    Args:
        websocket: The active WebSocket connection.

    Returns:
        None

    Raises:
        WebSocketDisconnect: Raised if the client disconnects during ping.
        RuntimeError: Raised if the socket is no longer writable.
    """
    try:
        while True:
            await asyncio.sleep(45)
            await websocket.send_json({"type": "ping"})
    except (WebSocketDisconnect, RuntimeError):
        # Connection closed or runtime error, exit cleanly
        pass


async def save_message(sender: str, encrypted_text: str) -> dict[str, Any]:
    """Insert a chat message into the Supabase messages table.

    Args:
        sender: The authenticated sender username.
        encrypted_text: The encrypted message body.

    Returns:
        The inserted row, including the generated id and reactions payload.

    Raises:
        Exception: Any database error is caught and logged locally.
    """
    try:
        response = await asyncio.to_thread(
            lambda: supabase_client.table("messages").insert({
                "sender": sender,
                "encrypted_text": encrypted_text,
            }).select("id,sender,encrypted_text,reactions").execute()
        )
        rows = response.data if response.data else []
        if isinstance(rows, list) and rows:
            return rows[0]
        if isinstance(rows, dict):
            return rows
        return {}
    except Exception as error:
        print(f"Error saving message to database: {str(error)}")
        return {}


async def toggle_message_reaction(message_id: int, sender: str, emoji: str) -> dict[str, Any]:
    """Toggle a sender's reaction for a stored message.

    Args:
        message_id: The Supabase row id for the message.
        sender: The authenticated sender username.

    Returns:
        A dictionary containing the message id and the updated reactions map.
    """
    try:
        response = await asyncio.to_thread(
            lambda: supabase_client.table("messages").select(
                "id,reactions"
            ).eq("id", message_id).limit(1).execute()
        )
        rows = response.data if response.data else []
        if not rows:
            return {}

        message_row = rows[0] if isinstance(rows, list) else rows
        reactions = message_row.get("reactions") if isinstance(message_row, dict) else {}
        if not isinstance(reactions, dict):
            reactions = {}

        if reactions.get(sender) == emoji:
            reactions.pop(sender, None)
        else:
            reactions[sender] = emoji

        await asyncio.to_thread(
            lambda: supabase_client.table("messages").update({
                "reactions": reactions,
            }).eq("id", message_id).execute()
        )

        return {
            "id": message_row.get("id", message_id) if isinstance(message_row, dict) else message_id,
            "reactions": reactions,
        }
    except Exception as error:
        print(f"Error updating message reactions: {str(error)}")
        return {}


async def handle_chat_payload(message_payload: dict[str, Any], authenticated_user: str) -> None:
    """Process a WebSocket payload for a message or reaction."""
    payload_type = str(message_payload.get("type", "message")).strip().lower()

    if payload_type == "like":
        try:
            message_id_raw = message_payload.get("message_id")
            sender = str(message_payload.get("sender", authenticated_user)).strip().lower()
            if sender != authenticated_user:
                sender = authenticated_user

            try:
                message_id = int(message_id_raw)
            except (TypeError, ValueError):
                return

            emoji = str(message_payload.get("emoji", "❤️"))
            print(f"[BACKEND] Processing like for message_id: {message_id}, emoji: {emoji}", flush=True)
            updated_message = await toggle_message_reaction(message_id, sender, emoji)
            if not updated_message:
                return

            print(f"[BACKEND] Supabase updated successfully.", flush=True)
            await manager.broadcast(json.dumps({
                "type": "like",
                "message_id": updated_message.get("id", message_id),
                "reactions": updated_message.get("reactions", {}),
            }))
            return
        except Exception as e:
            print(f"[BACKEND ERROR] {e}", flush=True)

    sender = str(message_payload.get("sender", authenticated_user)).strip().lower()
    encrypted_text = str(message_payload.get("text", ""))

    if sender != authenticated_user:
        sender = authenticated_user

    saved_message = await save_message(sender, encrypted_text)

    await manager.broadcast(json.dumps({
        "type": "message",
        "id": saved_message.get("id"),
        "sender": sender,
        "text": encrypted_text,
        "reactions": saved_message.get("reactions", {}),
    }))


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Return a simple health response for uptime checks.

    Returns:
        A status payload indicating the API is online.

    Raises:
        None
    """
    return {"status": "online"}


async def fetch_chat_history() -> list[dict[str, Any]]:
    """Fetch the most recent chat history from Supabase.

    Returns:
        A list of message dictionaries ordered by timestamp ascending.

    Raises:
        RuntimeError: Re-raises database errors with contextual information.
    """
    await asyncio.sleep(0)
    try:
        response = await asyncio.to_thread(
            lambda: supabase_client.table("messages").select(
                "id,sender,encrypted_text,reactions,timestamp"
            ).order(
                "timestamp", desc=False
            ).limit(50).execute()
        )
        return response.data if response.data else []
    except Exception as error:
        raise RuntimeError(f"Failed to fetch chat history: {str(error)}") from error


@app.get(
    "/history",
    responses={500: {"description": "Failed to retrieve chat history."}},
)
async def get_history() -> list[dict[str, Any]]:
    """Return chat history as JSON for the frontend.

    Returns:
        A JSON-compatible list of chat messages.

    Raises:
        HTTPException: Raised when Supabase query execution fails.
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
    """Handle a chat WebSocket connection.

    The client must send its username as the first text frame after connect.
    That username is validated against ALLOWED_USERS before chat messages are
    accepted. Subsequent messages are broadcast and persisted asynchronously.

    Args:
        websocket: The incoming WebSocket connection.

    Returns:
        None

    Raises:
        WebSocketDisconnect: Raised when the socket closes during receive.
    """
    keep_alive_task: asyncio.Task[None] | None = None
    authenticated_user = ""

    await manager.connect(websocket)

    try:
        authenticated_user = (await websocket.receive_text()).strip().lower()
        if authenticated_user not in ALLOWED_USERS:
            await websocket.close(code=4403, reason="username not allowed")
            return

        keep_alive_task = asyncio.create_task(keep_alive(websocket))

        while True:
            data = await websocket.receive_text()

            try:
                message_payload = json.loads(data)
                print(f"[BACKEND RECV] {message_payload}", flush=True)
            except json.JSONDecodeError:
                continue

            await handle_chat_payload(message_payload, authenticated_user)

    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
        if keep_alive_task is not None:
            keep_alive_task.cancel()
            with suppress(asyncio.CancelledError):
                await keep_alive_task


# Mount static files after all API and WebSocket routes
app.mount("/", StaticFiles(directory="static", html=True), name="static")
