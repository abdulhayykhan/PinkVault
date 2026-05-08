import os
from typing import Any
from dotenv import load_dotenv
from supabase import create_client, Client


# Load environment variables from .env file
load_dotenv()


def get_supabase_client() -> Client:
    """
    Initialize and return the authenticated Supabase client.
    
    Raises:
        ValueError: If SUPABASE_URL or SUPABASE_KEY is not set in environment variables.
    
    Returns:
        Client: Authenticated Supabase client instance.
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
