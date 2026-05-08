-- PinkVault Database Schema

-- 1. Create the messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender TEXT NOT NULL,
  encrypted_text TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create an index to speed up the /history endpoint queries
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);