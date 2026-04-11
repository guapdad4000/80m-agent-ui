const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf-8');

// 1. Remove mock welcome message
code = code.replace(
  /welcomeMessage: 'SYSTEM_ONLINE\. Sovereign Agent Council ready for deployment\. What shall we automate\?',/g,
  "welcomeMessage: '',"
);

code = code.replace(
  /return \[\{ id: 1, role: 'assistant', employee: 'Hermes', content: 'SYSTEM_ONLINE\. Sovereign Agent Council ready for deployment\. What shall we automate\?' \}\];/g,
  "return [];"
);

// 2. Change agents config to Prawnius
code = code.replace(
  /agents: \[[\s\S]*?\],/m,
  `agents: [
    { id: 'prawnius', icon: 'Bot', role: 'Quick Tasks', color: '#22c55e' },
    { id: 'claudnelius', icon: 'PenTool', role: 'Code & Design', color: '#3b82f6' },
    { id: 'knowledge_knaight', icon: 'Search', role: 'Research', color: '#f59e0b' },
    { id: 'clawdette', icon: 'CheckCircle2', role: 'Operations', color: '#ef4444' },
  ],`
);

// 3. Fix initial active employee
code = code.replace(
  /useState\(config\.agents\[0\]\?\.id \|\| 'Hermes'\)/g,
  "useState(config.agents[0]?.id || 'prawnius')"
);

code = code.replace(
  /p className="font-mono text-\[8px\] text-\[#22c55e\]">\{config\?\.selectedAgent \|\| 'PRAWN'\}_V4/g,
  'p className="font-mono text-[8px] text-[#22c55e]">{activeEmployee.toUpperCase()}_V4'
);

// 4. Update the chat API call
const originalApiCode = `
      try {
        // Build context block for the API
        const contextBlock = contextVars.length > 0
          ? \`\\n[PROJECT CONTEXT — \${projectNamespace || 'global'}]\\n\${contextVars.map(v => \`\${v.key}: \${v.value}\`).join('\\n')}\\n[/CONTEXT]\\n\`
          : '';
        const fullMessage = contextBlock + inputValue;

        const res = await fetch(config.apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: fullMessage, agent: activeEmployee, stream: true, namespace: projectNamespace, context: contextVars }),
          signal: AbortSignal.timeout(300000),
        });

        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        setAgentState('typing');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6);
            if (!raw.trim()) continue;

            try {
              const event = JSON.parse(raw);

              if (event.type === 'tool') {
                // Real-time tool display — animate mascot based on tool
                toolEvents.push(event);
                setToolEventsByMsg(prev => ({
                  ...prev,
                  [assistantMsgId]: [...(prev[assistantMsgId] || []), event]
                }));
                if (event.tool === 'websearch' || event.tool === 'search') {
                  setAgentState('searching');
                } else if (event.tool === 'code' || event.tool === 'code_exec') {
                  setAgentState('typing');
                }
              }

              if (event.type === 'thinking' || event.type === 'context') {
                // Show thinking inline — append as a system note
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.id === assistantMsgId && last.content.startsWith('[thinking]')) {
                    return prev.map(m => m.id === assistantMsgId ? { ...m, content: m.content + event.text } : m);
                  } else if (event.text) {
                    return [...prev, { id: Date.now(), role: 'system', content: \`[thinking] \${event.text}\` }];
                  }
                  return prev;
                });
              }

              if (event.type === 'chunk' || event.type === 'token' || event.type === 'delta') {
                fullResponse += event.text || event.content || '';
                setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullResponse } : m));
              }

              if (event.type === 'done' || event.type === 'ended') {
                fullResponse = event.response || fullResponse;
              }
            } catch {
              // Not JSON — treat as raw text chunk
              fullResponse += raw;
              setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullResponse } : m));
            }
          }
        }

        setAgentState('job-done');
        setTimeout(() => setAgentState('default'), 2000);

      } catch (err) {
        setAgentState('error');
        setTimeout(() => {
          setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: \`CONNECTION_ERROR: \${err.message}. Check your endpoint config in Settings.\` } : m));
          setAgentState('default');
        }, 2000);
      }
`;

const newApiCode = `
      try {
        // Build context block for the API
        const contextBlock = contextVars.length > 0
          ? \`\\n[PROJECT CONTEXT — \${projectNamespace || 'global'}]\\n\${contextVars.map(v => \`\${v.key}: \${v.value}\`).join('\\n')}\\n[/CONTEXT]\\n\`
          : '';
        const fullMessage = contextBlock + inputValue;

        // Step 1: Submit job
        const submitRes = await fetch(config.apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: fullMessage, agent_id: activeEmployee }),
          signal: AbortSignal.timeout(30000),
        });

        if (!submitRes.ok) throw new Error(\`HTTP \${submitRes.status}\`);
        const submitData = await submitRes.json();
        const jobId = submitData.job_id;
        if (!jobId) throw new Error('Missing job_id from Hermes backend');

        setAgentState('typing');

        let completed = false;
        // Step 2: Poll for completion
        const statusBase = new URL(config.apiEndpoint, window.location.origin).origin;
        for (let i = 0; i < 300; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const statusRes = await fetch(\`\${statusBase}/chat/status/\${jobId}\`, {
            signal: AbortSignal.timeout(10000),
          });
          if (!statusRes.ok) continue;
          const statusData = await statusRes.json();

          if (statusData.status === 'queued' || statusData.status === 'running') {
            // Keep typing state
            continue;
          }

          if (statusData.status === 'completed') {
            const responseText = statusData.result?.response || statusData.response || '';
            const events = statusData.result?.events || statusData.events || [];
            
            // Set tool events for sidebar display if needed
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
        setTimeout(() => setAgentState('default'), 2000);

      } catch (err) {
        setAgentState('error');
        setTimeout(() => {
          setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: \`CONNECTION_ERROR: \${err.message}. Check your endpoint config in Settings.\` } : m));
          setAgentState('default');
        }, 2000);
      }
`;

code = code.replace(originalApiCode.trim(), newApiCode.trim());

// 5. Update the ping check to use agent_id
code = code.replace(
  /body: JSON\.stringify\(\{ message: 'ping', stream: false \}\),/g,
  "body: JSON.stringify({ message: 'ping', agent_id: activeEmployee }),"
);

fs.writeFileSync('src/App.jsx', code);
console.log('Patched src/App.jsx');
