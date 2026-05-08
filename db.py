"""Database helper for PinkVault.

This module loads Supabase configuration from environment variables and
provides a factory function to create an authenticated Supabase client.

Environment variables expected:
    - SUPABASE_URL
    - SUPABASE_KEY
    - ALLOWED_USERS (optional, comma-separated)

Raises:
    - ValueError: If required Supabase environment variables are missing.
"""

import os

from dotenv import load_dotenv
from supabase import create_client, Client


# Load environment variables from .env file
load_dotenv()


def get_supabase_client() -> Client:
    """Initialize and return an authenticated Supabase client.

    Returns:
        A configured Supabase client for the current environment.

    Raises:
        ValueError: Raised when SUPABASE_URL or SUPABASE_KEY is missing.
    """
    supabase_url: str | None = os.getenv("SUPABASE_URL")
    supabase_key: str | None = os.getenv("SUPABASE_KEY")

    # Validation block: raise immediate ValueError if either variable is missing
    if not supabase_url:
        raise ValueError("SUPABASE_URL environment variable is not set")
    if not supabase_key:
        raise ValueError("SUPABASE_KEY environment variable is not set")

    # Return authenticated Supabase client
    return create_client(supabase_url, supabase_key)
