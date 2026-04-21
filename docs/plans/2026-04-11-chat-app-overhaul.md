# 80M Agent Chat UI Overhaul — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Refactor the 4,511-line App.jsx monolith into component architecture, add session management, and implement proper streaming UX — while preserving the exact visual aesthetic.

**Architecture:** Break the monolith into components/, hooks/, and utils/ directories. Move state into custom hooks. Add session data model alongside per-agent threads. Implement token-by-token SSE streaming with cancel support.

**Tech Stack:** React 19, Vite 8, Tailwind CSS 3, Framer Motion 12, lucide-react, react-markdown, remark-gfm, Web Speech API, Web Audio API, EventSource (SSE)

**Aesthetic Lock:** The beige/cream retro brutalist design (#1c1c1e bg, #eae7de surfaces, #22c55e accents, 3px borders, hard shadows, Fira Code mono, Playfair serif) is frozen. All new components must match existing Tailwind classes exactly.

---

## Phase 1: Architecture Refactor (Zero Visual Changes)

### Task 1: Create directory structure

**Objective:** Set up the component/hooks/utils directories before moving anything.

**Files:**
- Create: `src/components/` (directory)
- Create: `src/hooks/` (directory — already exists with useHermesApi.js, useOffline.js)
- Create: `src/utils/` (directory)

**Step 1:** Create directories

```bash
mkdir -p /home/falcon/Apps/code/80m-agent-ui/src/{components,hooks,utils}
```

**Step 2: Verify**

```bash
ls -la /home/falcon/Apps/code/80m-agent-ui/src/components /home/falcon/Apps/code/80m-agent-ui/src/hooks /home/falcon/Apps/code/80m-agent-ui/src/utils
```

Expected: 3 directories exist. hooks/ already contains useHermesApi.js, useOffline.js.

---

### Task 2: Extract useAudio hook

**Objective:** Move the useAudio hook (lines 62-136) into its own file.

**Files:**
- Create: `src/hooks/useAudio.js`
- Modify: `src/App.jsx` — replace lines 62-136 with import

**Step 1: Create the hook file**

```js
// src/hooks/useAudio.js
import { useRef, useCallback } from 'react';

export const useAudio = () => {
  const ctxRef = useRef(null);
  const unlockedRef = useRef(false);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctxRef.current;
  }, []);

  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    unlockedRef.current = true;
  }, [getCtx]);

  const env = (ctx, gainNode, attack, decay, sustain, release, duration) => {
    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + attack);
    gainNode.gain.linearRampToValueAtTime(sustain, now + attack + decay);
    gainNode.gain.setValueAtTime(sustain, now + duration - release);
    gainNode.gain.linearRampToValueAtTime(0, now + duration);
  };

  const playSendClick = useCallback(() => {
    if (!unlockedRef.current) return;
    try {
      const ctx = getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    } catch (_) {}
  }, [getCtx]);

  const playAgentChime = useCallback(() => {
    if (!unlockedRef.current) return;
    try {
      const ctx = getCtx();
      const now = ctx.currentTime;

      const tone = (freq, startTime, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.1, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      tone(523, now, 0.08);
      tone(659, now + 0.12, 0.08);
    } catch (_) {}
  }, [getCtx]);

  return { unlock, playSendClick, playAgentChime };
};
```

**Step 2: Replace in App.jsx**

Delete lines 62-136 (the entire useAudio const). Add import at top:

```js
import { useAudio } from './hooks/useAudio';
```

Remove `useAudio` from any inline definitions.

**Step 3: Verify**

```bash
cd /home/falcon/Apps/code/80m-agent-ui && npm run build 2>&1 | tail -5
```

Expected: Build succeeds with no errors.

---

### Task 3: Extract persistence utils

**Objective:** Move message persistence helpers and config helpers into utils files.

**Files:**
- Create: `src/utils/persistence.js` — message load/save/clean functions (lines 346-418)
- Create: `src/utils/config.js` — DEFAULT_CONFIG, ICON_MAP, loadConfig, saveConfig (lines 219-250)

**Step 1: Create src/utils/persistence.js**

Move these from App.jsx:
- `LEGACY_MESSAGES_KEY`, `AGENT_THREADS_KEY`
- `cleanMessages`, `loadMessages`, `saveMessages`, `loadMessagesForAgent`, `saveMessagesForAgent`
- `_messagesRef`, `_setMessagesRef`, `flushMessages`
- The `visibilitychange`, `pagehide`, `beforeunload` event listeners

Export all functions and constants. The side-effect listeners (visibilitychange, pagehide, beforeunload) should be in an `initPersistence()` function that gets called once.

**Step 2: Create src/utils/config.js**

Move these from App.jsx:
- `DEFAULT_CONFIG`
- `ICON_MAP`
- `loadConfig`, `saveConfig`
- `formatRelativeTime`

**Step 3: Update App.jsx imports**

Delete the moved code. Add:

```js
import { 
  LEGACY_MESSAGES_KEY, AGENT_THREADS_KEY,
  cleanMessages, loadMessages, saveMessages, 
  loadMessagesForAgent, saveMessagesForAgent, 
  initPersistence, _messagesRef, _setMessagesRef, flushMessages
} from './utils/persistence';

import { DEFAULT_CONFIG, ICON_MAP, loadConfig, saveConfig, formatRelativeTime } from './utils/config';
```

**Step 4: Call initPersistence() at top of App component**

```js
useEffect(() => { initPersistence(); }, []);
```

**Step 5: Verify**

```bash
cd /home/falcon/Apps/code/80m-agent-ui && npm run build 2>&1 | tail -5
```

Expected: Build succeeds.

---

### Task 4: Extract SSE streaming utility

**Objective:** Move tryStreamJobViaSSE (lines 267-341) into its own file.

**Files:**
- Create: `src/utils/streaming.js`
- Modify: `src/App.jsx`

**Step 1: Create src/utils/streaming.js**

Move `tryStreamJobViaSSE` function. Export it.

**Step 2: Update App.jsx**

Remove lines 267-341. Add import:

```js
import { tryStreamJobViaSSE } from './utils/streaming';
```

**Step 3: Verify build**

```bash
cd /home/falcon/Apps/code/80m-agent-ui && npm run build 2>&1 | tail -5
```

---

### Task 5: Extract WaveformIndicator component

**Objective:** Move the waveform canvas component into components/.

**Files:**
- Create: `src/components/WaveformIndicator.jsx` (lines 141-210)
- Modify: `src/App.jsx`

**Step 1: Create component file**

Copy lines 141-210 into `src/components/WaveformIndicator.jsx`. Add React import:

```js
import React, { useRef, useEffect } from 'react';
```

**Step 2: Update App.jsx**

Remove lines 141-210. Add import:

```js
import WaveformIndicator from './components/WaveformIndicator';
```

**Step 3: Verify build**

```bash
cd /home/falcon/Apps/code/80m-agent-ui && npm run build 2>&1 | tail -5
```

---

### Task 6: Extract FilmGrainCanvas + PaperBackground components

**Objective:** Move visual background components into components/.

**Files:**
- Create: `src/components/FilmGrainCanvas.jsx` (lines 1927-2058, includes NoiseOverlay alias)
- Create: `src/components/PaperBackground.jsx` (lines 1984-1997)
- Create: `src/components/AnimatedLogoCanvas.jsx` (lines 1998-2068)
- Create: `src/components/ParticleFieldCanvas.jsx` (lines 2069-2197)
- Modify: `src/App.jsx`

**Step 1:** Create each component file from the corresponding line ranges in App.jsx. Each gets a React import at top.

**Step 2:** Remove those sections from App.jsx. Add imports:

```js
import FilmGrainCanvas from './components/FilmGrainCanvas';
import PaperBackground from './components/PaperBackground';
import AnimatedLogoCanvas from './components/AnimatedLogoCanvas';
import ParticleFieldCanvas from './components/ParticleFieldCanvas';
```

**Step 3:** Verify build.

---

### Task 7: Extract AtmMascot component

**Objective:** Move the ATM mascot SVG (lines 2624-2877) into its own file. This is the biggest single component.

**Files:**
- Create: `src/components/AtmMascot.jsx` (lines 2624-2877)
- Modify: `src/App.jsx`

**Step 1:** Create `src/components/AtmMascot.jsx`. Move lines 2624-2877. Add imports:

```js
import React from 'react';
import { motion } from 'framer-motion';
```

**Step 2:** Remove from App.jsx. Add import:

```js
import AtmMascot from './components/AtmMascot';
```

**Step 3:** Verify build.

---

### Task 8: Extract HeaderStatusFrame component

**Objective:** Move header frame (lines 2848-2877) into components/.

**Files:**
- Create: `src/components/HeaderStatusFrame.jsx` (lines 2848-2877)
- Modify: `src/App.jsx`

Same pattern as previous tasks.

---

### Task 9: Extract OnboardingWizard component

**Objective:** Move onboarding (lines 2878-2926) into its own file.

**Files:**
- Create: `src/components/OnboardingWizard.jsx` (lines 2878-2926)
- Modify: `src/App.jsx`

Same pattern. Note: ONBOARDING_STEPS constant (line 2878) goes with it.

---

### Task 10: Extract MessageMarkdown component

**Objective:** Move the markdown renderer (lines 2927-2967) into its own file.

**Files:**
- Create: `src/components/MessageMarkdown.jsx` (lines 2927-2967)

This is a simple component that uses ReactMarkdown + remarkGfm. Import those.

---

### Task 11: Extract SettingsPanel component

**Objective:** Move the settings panel (lines 434-1145) — a 700+ line component — into its own file.

**Files:**
- Create: `src/components/SettingsPanel.jsx` (lines 434-1145)
- Modify: `src/App.jsx`

This component has nested sub-panels (connection, agents, profiles, endpoints). It's complex but self-contained. Pass props: `{ config, onSave, onClose }`. All its internal state stays local.

Dependencies it needs imported:
- All lucide icons it uses
- `getEndpointConfig`, `setEndpointConfig` from `./config/endpoints`
- `getHermesBase` from `./config/endpoints`

---

### Task 12: Extract all panel components

**Objective:** Move the remaining panel components into separate files.

**Files:**
- Create: `src/components/MemoryBrowserPanel.jsx` (lines 1146-1312) — depends on `getHermesBase`
- Create: `src/components/JobsPipelinePanel.jsx` (lines 1313-1453) — depends on `getHermesBase`
- Create: `src/components/MCPSettingsPanel.jsx` (lines 1454-1662)
- Create: `src/components/PWAInstallBanner.jsx` (lines 1663-1692)
- Create: `src/components/KnowledgeVaultPanel.jsx` (lines 1693-1753) — depends on `getHermesBase`
- Create: `src/components/SkillsHubPanel.jsx` (lines 1754-1919) — depends on `getHermesBase`
- Create: `src/components/PreviewPanel.jsx` (lines 2203-2413) — depends on `getLocalApiBase`, react-markdown
- Create: `src/components/FileTree.jsx` (lines 2416-2538) — depends on `getLocalApiBase`
- Create: `src/components/MemoryPanel.jsx` (lines 2541-2621)

Each gets its own imports at the top. Remove from App.jsx and add corresponding imports.

**Step:** Do all of these at once since they're independent. Verify build after.

---

### Task 13: Extract useChat hook

**Objective:** Create a new custom hook that encapsulates all chat state and logic.

**Files:**
- Create: `src/hooks/useChat.js`
- Modify: `src/App.jsx`

**What useChat manages:**
- `activeEmployee`, `setActiveEmployee`
- `agentThreadsRef` (the per-agent message stores)
- `messages`, `setMessages` (current agent's messages)
- `nextMessageId` function
- `updateAgentThread` function
- `handleSend` function (the big one, lines 3479-3600+)
- `agentState`, `setAgentState`
- `agentThinking`, `setAgentThinking`
- `pendingByAgent`, `setPendingByAgent`
- `unreadByAgent`, `setUnreadByAgent`
- `messageCount`, `setMessageCount`
- `toolEventsByMsg`, `setToolEventsByMsg`
- `expandedTools`, `setExpandedTools`

**Parameters/dependencies the hook needs:**
- `config` (for apiEnabled, apiEndpoint, agents)
- `projectNamespace` and `contextVars` (for context prefix)
- `pulseMascot` callback (from App)
- Audio callbacks: `playSendClick`, `playAgentChime`

**Returns:**
All the state + functions listed above.

**IMPORTANT:** This is the most complex extraction. The hook should be a thin wrapper — it does NOT own the API transport. It calls `tryStreamJobViaSSE` and `buildApiPayload`/`extractAssistantText` from utils. It does NOT manage offline queuing (that stays in useHermesApi).

**Step 1:** Create hook. Move all the listed state and the handleSend function.

**Step 2:** Update App.jsx to use the hook:

```js
const {
  activeEmployee, setActiveEmployee,
  messages, setMessages,
  handleSend,
  agentState, agentThinking,
  pendingByAgent, unreadByAgent,
  messageCount,
  toolEventsByMsg, expandedTools, setExpandedTools,
  nextMessageId,
} = useChat({ config, projectNamespace, contextVars, pulseMascot, playSendClick, playAgentChime });
```

**Step 3:** Verify build. This will likely require some props-wiring adjustments in the JSX.

---

### Task 14: Extract useVoice hook

**Objective:** Move voice recording state and logic into its own hook.

**Files:**
- Create: `src/hooks/useVoice.js`
- Modify: `src/App.jsx`

**What useVoice manages:**
- `isRecording`, `setIsRecording`
- `recordingRef`
- `recognitionRef`
- `voiceError`, `setVoiceError`
- `ttsEnabled`, `setTtsEnabled`
- `spokenMessageIdsRef`
- `startRecording`, `stopRecording`, `toggleRecording`
- `speakText`
- TTS effect (auto-speak on new assistant messages)

**Parameters:**
- `messages` (to detect new assistant messages for TTS)
- `inputValue`, `setInputValue` (to append transcript)
- `onSend` callback (to auto-send after recording)

**Returns:**
All voice-related state and functions.

---

### Task 15: Final Phase 1 verification

**Objective:** Ensure the refactor is complete with zero visual changes.

**Step 1: Build check**

```bash
cd /home/falcon/Apps/code/80m-agent-ui && npm run build 2>&1
```

Expected: Clean build, no warnings.

**Step 2: Dev server check**

```bash
cd /home/falcon/Apps/code/80m-agent-ui && npm run dev &
```

Open in browser. Verify:
- All 4 agents visible in sidebar
- Switching agents works
- Sending a message works (if Hermes is running)
- Mascot animations work
- Settings panel opens/closes
- Voice input button visible
- Film grain overlay visible
- All panel buttons work (Webhook, Memory, Jobs, MCP, Skills, Vault)
- PWA install banner (if applicable)

**Step 3: Line count check**

```bash
wc -l /home/falcon/Apps/code/80m-agent-ui/src/App.jsx
```

Expected: Under 1500 lines (down from 4511). The rest is in components/ and hooks/.

**Step 4: Commit**

```bash
cd /home/falcon/Apps/code/80m-agent-ui
git add -A
git commit -m "refactor: break App.jsx monolith into components + hooks + utils (Phase 1)"
```

---

## Phase 2: Session Management

### Task 16: Define session data model

**Objective:** Create the session data structure and persistence layer.

**Files:**
- Create: `src/utils/sessions.js`

**Data model:**

```js
// Session structure
{
  id: "sess_1712847600_a1b2c3",      // timestamp + random
  title: "Help me build a landing page", // auto from first msg or user-set
  agentId: "prawnius",                // which agent owns this session
  messages: [],                       // array of { id, role, content, ... }
  createdAt: 1712847600000,           // timestamp
  updatedAt: 1712847600000,           // timestamp
  archived: false,                    // soft delete
}
```

**Storage:**
- Key: `80m-agent-sessions`
- Structure: `{ [agentId]: { [sessionId]: Session } }`
- Plus: `80m-active-session` — `{ [agentId]: sessionId }`

**Functions to create:**

```js
export const loadSessions = () => { /* from localStorage */ };
export const saveSessions = (sessions) => { /* to localStorage */ };
export const loadActiveSessionIds = () => { /* from localStorage */ };
export const saveActiveSessionIds = (ids) => { /* to localStorage */ };

export const createSession = (agentId) => { /* new session with auto ID */ };
export const getSessionsForAgent = (sessions, agentId) => { /* sorted by updatedAt desc */ };
export const getSessionMessages = (sessions, agentId, sessionId) => { /* get messages array */ };
export const updateSessionMessages = (sessions, agentId, sessionId, messages) => { /* update + set updatedAt */ };
export const autoTitleSession = (sessions, agentId, sessionId, firstMessage) => { /* title from first 50 chars of first user msg */ };
export const deleteSession = (sessions, agentId, sessionId) => { /* remove or archive */ };
export const renameSession = (sessions, agentId, sessionId, title) => { /* update title */ };
```

**Step 1:** Write the file with all functions.

**Step 2:** Write a quick smoke test:

```bash
node -e "
const { createSession, getSessionsForAgent } = await import('./src/utils/sessions.js');
const s = createSession('prawnius');
console.log(s.id, s.agentId);
"
```

Expected: Session object with id and agentId printed.

**Step 3: Migrate existing data**

Add a `migrateFromLegacy()` function that:
- Reads old `80m-agent-messages-by-agent` format
- For each agentId, if there are messages, wrap them in a single "Migrated Session"
- Returns the new sessions structure
- Called once on first load (checked via `80m-sessions-migrated` flag)

---

### Task 17: Create useSessions hook

**Objective:** React hook wrapping the session data model.

**Files:**
- Create: `src/hooks/useSessions.js`

**What it provides:**

```js
export default function useSessions({ agents }) {
  // State
  const [sessions, setSessions] = useState(() => {
    const loaded = loadSessions();
    if (Object.keys(loaded).length === 0) return migrateFromLegacy();
    return loaded;
  });
  const [activeSessionIds, setActiveSessionIds] = useState(() => loadActiveSessionIds());

  // Persist on change
  useEffect(() => { saveSessions(sessions); }, [sessions]);
  useEffect(() => { saveActiveSessionIds(activeSessionIds); }, [activeSessionIds]);

  // Derived
  const currentAgentId = /* from parent */;
  const activeSessionId = activeSessionIds[currentAgentId];
  const activeSession = sessions[currentAgentId]?.[activeSessionId] || null;
  const agentSessions = getSessionsForAgent(sessions, currentAgentId);

  // Actions
  const newChat = () => { /* create session, set active */ };
  const switchSession = (sessionId) => { /* set active */ };
  const deleteSessionAction = (sessionId) => { /* delete, switch to another or new */ };
  const renameSessionAction = (sessionId, title) => { /* rename */ };
  const updateMessages = (messages) => { /* update current session messages */ };
  const autoTitle = (firstMessage) => { /* auto-title current session */ };

  return {
    sessions: agentSessions,
    activeSession,
    activeSessionId,
    newChat,
    switchSession,
    deleteSession: deleteSessionAction,
    renameSession: renameSessionAction,
    updateMessages,
    autoTitle,
  };
}
```

---

### Task 18: Integrate useSessions into useChat

**Objective:** Replace the flat per-agent message arrays with session-based storage.

**Files:**
- Modify: `src/hooks/useChat.js`
- Modify: `src/App.jsx`

**Changes to useChat:**
- Accept `useSessions` return value as a parameter
- When switching agents: call `sessions.switchSession(activeSessionId)`
- When messages update: call `sessions.updateMessages(messages)`
- On first user message in a session: call `sessions.autoTitle(firstMsg)`
- When "New Chat" clicked: call `sessions.newChat()`

**Changes to App:**
- Wrap useSessions around useChat
- Pass session state down to sidebar

---

### Task 19: Build SessionList component

**Objective:** Sidebar section showing sessions for the current agent.

**Files:**
- Create: `src/components/SessionList.jsx`

**Props:**
```js
{
  agentId,
  sessions,          // array of session objects, sorted by updatedAt desc
  activeSessionId,   // currently selected
  onSwitch,          // (sessionId) => void
  onNewChat,         // () => void
  onDelete,          // (sessionId) => void
  onRename,          // (sessionId, title) => void
}
```

**Design (matching existing aesthetic):**
- "NEW CHAT" button at top — green #22c55e accent, border-[2px] border-[#111], font-mono text-[8px] font-black
- Each session as a compact row:
  - Title (truncate, font-mono text-[8px])
  - Timestamp (relative, font-mono text-[6px] text-[#aaa])
  - Active state: bg-[#111] text-[#eae7de], left border accent
  - Hover: right-side delete icon (Trash2, only on hover)
  - Double-click to rename (inline edit)
- Group by "Today", "Yesterday", "This Week", "Older" (like ChatGPT)

**Step 1:** Create component.

**Step 2:** Wire into sidebar. Currently the sidebar shows agents → projects → file tree. Add sessions between agents and projects:

```
[Agent strip (horizontal)]
[New Chat button]
[Session list — scrollable]
[--- divider ---]
[Projects section]
[File tree section]
```

---

### Task 20: Add "New Chat" button to chat area header

**Objective:** Add a prominent "New Chat" action accessible from the main chat view, not just sidebar.

**Files:**
- Modify: `src/App.jsx` (or the component owning the chat header)

**Design:**
- Small `+` icon button next to agent name in chat header
- Tooltip: "New Chat"
- On click: `sessions.newChat()`, clears input, resets agent state
- Keyboard shortcut: `Cmd+Shift+N`

---

### Task 21: Phase 2 integration test

**Objective:** Verify session management works end-to-end.

**Step 1:** Build check

```bash
cd /home/falcon/Apps/code/80m-agent-ui && npm run build
```

**Step 2:** Manual verification in browser:
- Open app → see one "Migrated" session in sidebar
- Click "New Chat" → new empty session created, old one still in list
- Send a message → session auto-titled from first message
- Switch between sessions → messages swap correctly
- Switch agents → each agent has its own session list
- Delete a session → removed from list
- Refresh page → sessions persist
- Old localStorage data migrated correctly

**Step 3:** Commit

```bash
cd /home/falcon/Apps/code/80m-agent-ui
git add -A
git commit -m "feat: add session management with New Chat, per-agent sessions, migration (Phase 2)"
```

---

## Phase 3: Streaming Display + Conversation Context

### Task 22: Add conversation history to API payload

**Objective:** Send the last N messages as conversation context with each request.

**Files:**
- Modify: `src/lib/chatTransport.js`
- Modify: `src/hooks/useChat.js`

**Changes to chatTransport.js:**

```js
export const buildApiPayload = ({ endpoint, message, agentId, history = [] }) => {
  if (isOpenAICompatibleEndpoint(endpoint)) {
    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];
    return {
      model: 'local-model',
      messages,
      temperature: 0.2,
      stream: false,
      metadata: { agent_id: agentId },
    };
  }
  return { message, agent_id: agentId, history };
};
```

**Changes to useChat.js:**

In handleSend, get last 20 messages from the current session and pass as `history`:

```js
const history = messages.slice(-20).map(m => ({ role: m.role, content: m.content }));
const payload = buildApiPayload({ endpoint: config.apiEndpoint, message: fullMessage, agentId: targetAgent, history });
```

**Step 1:** Implement changes.

**Step 2:** Verify — send a message, check browser DevTools Network tab that the request body includes `history` array.

---

### Task 23: Implement token-by-token SSE streaming

**Objective:** Show text appearing character by character as SSE events arrive, instead of waiting for full completion.

**Files:**
- Modify: `src/utils/streaming.js`
- Modify: `src/hooks/useChat.js`

**Changes to streaming.js:**

Add a new function `streamJobWithCallbacks`:

```js
export const streamJobWithCallbacks = ({ baseUrl, jobId, onDelta, onToolEvent, onComplete, onError, onTimeout, timeoutMs = 900000 }) => {
  // Returns an abort controller for cancellation
  const controller = new AbortController();

  const url = `${baseUrl}/chat/stream/${encodeURIComponent(jobId)}`;
  const es = new EventSource(url);

  let responseText = '';
  const timer = setTimeout(() => {
    es.close();
    onTimeout();
  }, timeoutMs);

  es.onmessage = (event) => {
    const data = event?.data;
    if (!data) return;
    if (data === '[DONE]') {
      clearTimeout(timer);
      es.close();
      onComplete(responseText);
      return;
    }
    try {
      const parsed = JSON.parse(data);
      if (parsed.status === 'failed') {
        clearTimeout(timer);
        es.close();
        onError(parsed.error || 'Stream failed');
        return;
      }
      if (parsed.type === 'tool') {
        onToolEvent(parsed);
      }
      const delta = parsed.delta || parsed.token || parsed.text || '';
      if (delta) {
        responseText += delta;
        onDelta(responseText); // call with FULL text so far — React re-renders the message
      }
      if (parsed.response) {
        responseText = parsed.response;
        onDelta(responseText);
      }
      if (parsed.status === 'completed') {
        clearTimeout(timer);
        es.close();
        onComplete(responseText);
      }
    } catch {
      // Non-JSON chunk, append as text
      responseText += String(data);
      onDelta(responseText);
    }
  };

  es.onerror = () => {
    clearTimeout(timer);
    if (responseText) {
      onComplete(responseText); // partial completion
    } else {
      onError('Connection lost');
    }
  };

  return {
    abort: () => {
      clearTimeout(timer);
      es.close();
      controller.abort();
    }
  };
};
```

**Changes to useChat.js handleSend:**

Replace the `tryStreamJobViaSSE` call with `streamJobWithCallbacks`:

```js
// After getting jobId from submit:
const streamHandle = streamJobWithCallbacks({
  baseUrl: HERMES_BASE,
  jobId,
  onDelta: (partialText) => {
    // Update the assistant message in-place with partial text
    updateAgentThread(targetAgent, prev =>
      prev.map(m => m.id === assistantMsgId ? { ...m, content: partialText } : m)
    );
  },
  onToolEvent: (event) => {
    setToolEventsByMsg(prev => ({
      ...prev,
      [assistantMsgId]: [...(prev[assistantMsgId] || []), event],
    }));
  },
  onComplete: (finalText) => {
    updateAgentThread(targetAgent, prev =>
      prev.map(m => m.id === assistantMsgId ? { ...m, content: finalText } : m)
    );
    setAgentThinking(false);
    setPendingByAgent(prev => ({ ...prev, [targetAgent]: Math.max(0, (prev[targetAgent] || 0) - 1) }));
    pulseMascot('job-done', 1500);
  },
  onError: (err) => { /* handle error, queue for retry */ },
  onTimeout: () => { /* handle timeout */ },
});

// Store the abort handle so we can cancel
streamAbortRef.current = streamHandle;
```

---

### Task 24: Add cancel streaming button

**Objective:** Let the user stop a response mid-stream.

**Files:**
- Create: `src/components/CancelButton.jsx`
- Modify: `src/App.jsx` (chat input area)

**Design:**
- Replace the Execute/Send button with a "Stop" button while streaming
- Stop button: bg-[#ef4444] text, "Stop" label, Square icon
- On click: call `streamAbortRef.current.abort()`
- Show the partial response as-is (don't delete it)

**In useChat:**
- Add `isStreaming` state, set true when stream starts, false on complete/error/abort
- Expose `cancelStream` function that calls the abort handle
- Return `isStreaming` and `cancelStream`

**In App.jsx input area:**

```jsx
{isStreaming ? (
  <button type="button" onClick={cancelStream} className="...">
    <Square size={13} /> Stop
  </button>
) : (
  <button type="submit" disabled={!inputValue.trim()} className="...">
    <Send size={13} /> Execute
  </button>
)}
```

---

### Task 25: Show streaming typing indicator

**Objective:** While streaming, show a visual indicator that the agent is actively writing.

**Files:**
- Modify: `src/components/MessageMarkdown.jsx` or inline in the message rendering

**Design:**
- While `agentThinking && isStreaming`, append a blinking cursor `▌` at the end of the message content
- The cursor is a `<span>` with CSS animation:
  ```css
  @keyframes blink-cursor { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
  ```
- When streaming completes, cursor disappears

**Implementation:**
- In the message rendering loop, if `msg.content` is being streamed (detect via `isStreaming && msg.id === streamingMsgId`), append the cursor span after the markdown content.

---

### Task 26: Show tool events during streaming

**Objective:** Display tool calls as expandable inline blocks as they happen.

**Files:**
- Modify: `src/App.jsx` (message rendering section)

**Current behavior:** Tool events are only shown after completion, in an expandable thread.

**New behavior:** As tool events arrive during streaming:
1. Show a compact "Using tool_name..." line below the message
2. After streaming completes, collapse into the existing expandable accordion
3. Tool events during stream: small pill `bg-[#111] text-[#22c55e] font-mono text-[7px]` showing tool name
4. Animate in with framer-motion `initial={{ opacity: 0, y: 8 }}`

---

### Task 27: Multi-line input (textarea)

**Objective:** Replace the single-line `<input>` with an auto-growing `<textarea>`.

**Files:**
- Modify: `src/App.jsx` (the form input section, around line 4288)

**Changes:**
- `<input>` → `<textarea>`
- Auto-grow: `rows={1}` + `onInput` handler that adjusts height:

```js
const handleInputResize = (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
};
```

- Enter sends, Shift+Enter adds newline:

```js
onKeyDown={(e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend(e);
  }
}}
```

- Styling: same as current input but with `resize-none overflow-y-auto max-h-[200px]`

---

### Task 28: Phase 3 integration test

**Objective:** Verify streaming and context work end-to-end.

**Manual verification:**
1. Open app, start a new chat
2. Send "My name is Falcon" → response appears token by token
3. Send "What did I say my name was?" → agent responds correctly (proving context works)
4. While agent is streaming, click "Stop" → stream stops, partial response preserved
5. Tool events appear inline during streaming
6. Multi-line input: Shift+Enter adds newline, Enter sends
7. Textarea auto-grows with content

**Commit:**

```bash
cd /home/falcon/Apps/code/80m-agent-ui
git add -A
git commit -m "feat: streaming display, conversation context, cancel, multi-line input (Phase 3)"
```

---

## Summary

| Phase | Tasks | Focus | App.jsx after |
|-------|-------|-------|----------------|
| 1 | Tasks 1-15 (15 tasks) | Break monolith into components + hooks + utils | ~1200 lines |
| 2 | Tasks 16-21 (6 tasks) | Session management, New Chat, migration | ~1100 lines |
| 3 | Tasks 22-28 (7 tasks) | Streaming, context, cancel, multi-line | ~1000 lines |

**Total: 28 tasks across 3 phases.**

**After all phases, the codebase structure will be:**

```
src/
  App.jsx          (~1000 lines — layout + wiring only)
  components/
    AtmMascot.jsx
    AnimatedLogoCanvas.jsx
    CancelButton.jsx
    FilmGrainCanvas.jsx
    FileTree.jsx
    HeaderStatusFrame.jsx
    JobsPipelinePanel.jsx
    KnowledgeVaultPanel.jsx
    MCPSettingsPanel.jsx
    MemoryBrowserPanel.jsx
    MemoryPanel.jsx
    MessageMarkdown.jsx
    OnboardingWizard.jsx
    PaperBackground.jsx
    PreviewPanel.jsx
    PWAInstallBanner.jsx
    SessionList.jsx
    SettingsPanel.jsx
    SkillsHubPanel.jsx
    WaveformIndicator.jsx
  hooks/
    useAudio.js
    useChat.js
    useHermesApi.js
    useOffline.js
    useSessions.js
    useVoice.js
  utils/
    config.js
    persistence.js
    sessions.js
    streaming.js
  lib/
    chatTransport.js
  config/
    endpoints.js
```