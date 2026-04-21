# 80M Agent Chat — Standalone Backend

This app now has its own standalone backend and app-owned SQLite database.

## What it owns

- Agent thread metadata
- Thread message history
- Hermes session mapping per agent

SQLite DB path:
- `~/.80m-agent-chat/chat.db`

## Runtime pieces

Frontend:
- `80m-agent-ui`

Standalone backend:
- `80m-agent-ui/agent-chat-service.cjs`

Hermes:
- external execution engine only
- transcript fallback source: `~/.hermes/state.db`

## Run

From `80m-agent-ui/`:

```bash
npm run server
npm run dev
```

Default backend URL:
- `http://localhost:5174`

## Key endpoints

- `GET /health`
- `GET /sessions`
- `POST /chat`
- `GET /chat/status/:job_id`
- `GET /chat/stream/:job_id`
- `GET /agent-context/:agent_id`
- `GET /chat/history/:session_id`

## Notes

- No dependency on Cortex Mobile tables
- No dependency on `lifeos_chat_sessions`
- No dependency on local PostgreSQL
- Frontend persists per-agent `session_id` locally for fast resume
- Backend owns canonical app thread history in SQLite
