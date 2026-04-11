import re

with open('src/App.jsx', 'r') as f:
    code = f.read()

# 1. Update config agents & welcome message
code = re.sub(
    r"agents:\s*\[.*?\]\s*,",
    """agents: [
    { id: 'prawnius', icon: 'Bot', role: 'Quick Tasks', color: '#22c55e' },
    { id: 'claudnelius', icon: 'PenTool', role: 'Code & Design', color: '#3b82f6' },
    { id: 'knowledge_knaight', icon: 'Search', role: 'Research', color: '#f59e0b' },
    { id: 'clawdette', icon: 'CheckCircle2', role: 'Operations', color: '#ef4444' },
  ],""",
    code,
    flags=re.DOTALL
)
code = re.sub(
    r"welcomeMessage:\s*'.*?',",
    "welcomeMessage: '',",
    code
)

# 2. Fix the fetch header and active agent config
code = re.sub(
    r"const HERMES_HTTP = '.*?';",
    "const HERMES_HTTP = 'http://127.0.0.1:5174';",
    code
)
if "const HERMES_HTTP" not in code:
    code = code.replace("const DEFAULT_CONFIG =", "const HERMES_HTTP = 'http://127.0.0.1:5174';\nconst DEFAULT_CONFIG =")

code = re.sub(
    r"useState\(config\.agents\[0\]\?\.id \|\| 'Hermes'\)",
    "useState(config.agents[0]?.id || 'prawnius')",
    code
)

# 3. Completely Strip History and LocalStorage for Messages
code = re.sub(
    r"const loadMessages = \(\) => \{[\s\S]*?\n\};",
    "const loadMessages = () => [];",
    code
)
code = re.sub(
    r"const saveMessages = \(msgs\) => \{[\s\S]*?\n\};",
    "const saveMessages = () => {};",
    code
)
code = re.sub(
    r"// --- New: Conversations \(real CRUD\) ---[\s\S]*?// --- New: Build agents from config ---",
    """const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');

  // --- New: Build agents from config ---""",
    code,
    flags=re.DOTALL
)

# 4. Remove History Tab and View
code = re.sub(
    r"<button\s+onClick=\{\(\) => setViewMode\('history'\)\}.*?</button>",
    "",
    code,
    flags=re.DOTALL
)
code = re.sub(
    r"className=\"grid grid-cols-4 gap-1 bg-\[#2a2a2e\]/60 backdrop-blur-md border border-\[#3a3a3e\] p-1\"",
    "className=\"grid grid-cols-3 gap-1 bg-[#2a2a2e]/60 backdrop-blur-md border border-[#3a3a3e] p-1\"",
    code
)
code = re.sub(
    r"\{viewMode === 'history' && \([\s\S]*?<\/motion\.div>\s*\)\}",
    "",
    code,
    flags=re.DOTALL
)

# 5. Fix agentThinking state & mascot overlay
code = re.sub(
    r"const \[agentState, setAgentState\] = useState\('default'\);",
    "const [agentState, setAgentState] = useState('default');\n  const [agentThinking, setAgentThinking] = useState(false);",
    code
)
code = re.sub(
    r"const WaveformIndicator = \(\{ agentState, isRecording \}\) => \{",
    "const WaveformIndicator = ({ agentState, isRecording, agentThinking }) => {",
    code
)
code = re.sub(
    r"const isActive = isRecording \|\| \['processing', 'typing', 'searching', 'urgent'\]\.includes\(agentState\);",
    "const isActive = isRecording || agentThinking || ['processing', 'typing', 'searching', 'urgent'].includes(agentState);",
    code
)

# 6. Build the new Async Job fetch logic replacing the stream logic
original_fetch_logic = r"// If API is enabled, make a real request[\s\S]*?} else {"
new_fetch_logic = """// If API is enabled, make a real request
    if (config.apiEnabled && config.apiEndpoint) {
      setAgentState('processing');
      setAgentThinking(true);
      const assistantMsgId = Date.now() + 1;
      setToolEventsByMsg(prev => ({ ...prev, [assistantMsgId]: [] }));

      // Add placeholder assistant message (empty, we'll fill it when the job completes)
      setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', employee: activeEmployee, content: '' }]);

      try {
        const contextBlock = contextVars.length > 0
          ? `\\n[PROJECT CONTEXT — ${projectNamespace || 'global'}]\\n${contextVars.map(v => `${v.key}: ${v.value}`).join('\\n')}\\n[/CONTEXT]\\n`
          : '';
        const fullMessage = contextBlock + inputValue;

        const submitRes = await fetch(config.apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: fullMessage, agent_id: activeEmployee }),
          signal: AbortSignal.timeout(30000),
        });

        if (!submitRes.ok) throw new Error(`HTTP ${submitRes.status}`);
        const submitData = await submitRes.json();
        const jobId = submitData.job_id;
        if (!jobId) throw new Error('Missing job_id from Hermes backend');

        let completed = false;
        const statusBase = new URL(config.apiEndpoint, window.location.origin).origin;
        for (let i = 0; i < 300; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const statusRes = await fetch(`${statusBase}/chat/status/${jobId}`, {
            signal: AbortSignal.timeout(10000),
          });
          if (!statusRes.ok) continue;
          const statusData = await statusRes.json();

          if (statusData.status === 'queued' || statusData.status === 'running') {
            setAgentState('typing');
            continue;
          }

          if (statusData.status === 'completed') {
            const responseText = statusData.result?.response || statusData.response || '';
            const events = statusData.result?.events || statusData.events || [];
            setToolEventsByMsg(prev => ({ ...prev, [assistantMsgId]: events.filter(e => e.type === 'tool') }));
            setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: responseText || '[No response returned]' } : m));
            completed = true;
            break;
          }

          if (statusData.status === 'failed') {
            throw new Error(statusData.result?.error || statusData.error || 'Hermes job failed');
          }
        }

        if (!completed) throw new Error('Hermes job timeout');

        setAgentState('job-done');
        setTimeout(() => setAgentState('default'), 1500);
      } catch (err) {
        setAgentState('error');
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: `CONNECTION_ERROR: ${err.message}` } : m));
        setTimeout(() => setAgentState('default'), 1500);
      } finally {
        setAgentThinking(false);
      }
    } else {"""
# Fix literal backslashes in the python string interpolation
new_fetch_logic = new_fetch_logic.replace("\\n", "\\\\n")
code = re.sub(original_fetch_logic, new_fetch_logic, code, flags=re.DOTALL)


# 7. UI map replacements to hide empty bubble during "processing" and fix hover z-index
ui_map_replacement = """{messages.filter(msg => msg.role !== 'assistant' || msg.content || (toolEventsByMsg[msg.id] && toolEventsByMsg[msg.id].length > 0) || agentThinking).map((msg, index) => (
                    <motion.div"""
code = re.sub(r"\{messages\.map\(\(msg, index\) => \(\n\s*<motion\.div", ui_map_replacement, code)

content_replacement = """{msg.content ? (
                        <p className="font-mono text-base lg:text-lg leading-relaxed whitespace-pre-wrap tracking-tight">{msg.content}</p>
                      ) : agentThinking && index === messages.length - 1 ? (
                        <div className="flex items-center gap-2 text-[#888] py-2"><Activity size={14} className="animate-pulse" /> <span className="font-mono text-[10px] uppercase tracking-widest">Processing...</span></div>
                      ) : null}"""
code = re.sub(
    r"<p className=\"font-mono text-base lg:text-lg leading-relaxed whitespace-pre-wrap tracking-tight\">\{msg\.content\}</p>",
    content_replacement,
    code
)

tooltip_replacement = """<div className="absolute -top-4 -left-4 -rotate-12 group z-50 cursor-help">
                          <Bot size={18} strokeWidth={2} className="text-[#22c55e] drop-shadow-[0_2px_8px_rgba(34,197,94,0.4)]" />
                          <div className="absolute bottom-full left-0 mb-2 px-2 py-1 bg-[#1c1c1e] border-[2px] border-[#3a3a3e] shadow-[2px_2px_0_0_#22c55e] opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 whitespace-nowrap z-[100] pointer-events-none">
                            <p className="font-mono text-[8px] font-black uppercase text-[#22c55e]">{msg.employee}_V4</p>
                          </div>
                        </div>"""
code = re.sub(
    r"<div className=\"absolute -top-4 -left-4 -rotate-12 group\">\n\s*<Bot size=\{18\}.*?</div>\n\s*</div>",
    tooltip_replacement,
    code,
    flags=re.DOTALL
)

# Fix connection checking to use agent_id instead of stream: false
code = re.sub(
    r"body: JSON\.stringify\(\{ message: 'ping', stream: false \}\),",
    "body: JSON.stringify({ message: 'ping', agent_id: activeEmployee }),",
    code
)

with open('src/App.jsx', 'w') as f:
    f.write(code)

print("Applied full comprehensive patch successfully.")
