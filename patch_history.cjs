const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf-8');

// 1. Remove conversations state and related CRUD functions
code = code.replace(
  /\/\/ --- New: Conversations \(real CRUD\) ---[\s\S]*?\/\/ --- New: Build agents from config ---/m,
  `const [messages, setMessages] = useState(() => ensureUniqueMessageIds(loadMessages()));
  const [inputValue, setInputValue] = useState('');

  // --- New: Build agents from config ---`
);

// 2. Remove History tab button from the UI
code = code.replace(
  /<button[\s\S]*?onClick=\{\(\) => setViewMode\('history'\)\}[\s\S]*?<\/button>/m,
  ''
);

// 3. Fix the grid cols from 4 to 3 since one tab is removed
code = code.replace(
  /className="grid grid-cols-4 gap-1 bg-\[#2a2a2e\]\/60 backdrop-blur-md border border-\[#3a3a3e\] p-1"/,
  'className="grid grid-cols-3 gap-1 bg-[#2a2a2e]/60 backdrop-blur-md border border-[#3a3a3e] p-1"'
);

// 4. Remove the viewMode === 'history' conditional render
code = code.replace(
  /\{viewMode === 'history' && \([\s\S]*?<\/motion\.div>\s*\)\}/m,
  ''
);

// 5. Clean up localStorage in useEffect (so past history is cleared on mount)
code = code.replace(
  /useEffect\(\(\) => \{ localStorage\.setItem\('80m-project-root', projectRoot\); \}, \[projectRoot\]\);/,
  `useEffect(() => { localStorage.setItem('80m-project-root', projectRoot); }, [projectRoot]);

  useEffect(() => {
    localStorage.removeItem('80m-agent-conversations');
    localStorage.removeItem('80m-agent-messages');
  }, []);`
);

// 6. Remove 'New Conversation' from command palette
code = code.replace(
  /\{ label: 'New Conversation', icon: <MessageSquare size=\{14\} \/>, action: \(\) => \{ createConversation\(\); setShowCommandPalette\(false\); \} \},/,
  ''
);

fs.writeFileSync('src/App.jsx', code);
console.log('Patched App.jsx to remove history.');
