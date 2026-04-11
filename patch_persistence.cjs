const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf-8');

// 1. Restore loadMessages
code = code.replace(
  /const loadMessages = \(\) => \{\n  try \{\n    const saved = localStorage\.getItem\('80m-agent-messages'\);\n    if \(saved\) return JSON\.parse\(saved\);\n  \} catch \{\}\n  return \[\];\n\};/,
  `const loadMessages = () => {
  try {
    const saved = localStorage.getItem('80m-agent-messages');
    if (saved) return ensureUniqueMessageIds(JSON.parse(saved));
  } catch {}
  return [];
};`
);

// 2. Restore saveMessages
code = code.replace(
  /const saveMessages = \(\) => \{\};/,
  `const saveMessages = (msgs) => {
  try {
    localStorage.setItem('80m-agent-messages', JSON.stringify(msgs.slice(-100)));
  } catch {}
};`
);

// 3. Add useEffect to save messages
code = code.replace(
  /const \[inputValue, setInputValue\] = useState\(''\);/,
  `const [inputValue, setInputValue] = useState('');

  // Sync messages to local storage so hot-reloads don't wipe the chat
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);`
);

// 4. Remove the localStorage cleanup we added before
code = code.replace(
  /useEffect\(\(\) => \{\n    localStorage\.removeItem\('80m-agent-conversations'\);\n    localStorage\.removeItem\('80m-agent-messages'\);\n  \}, \[\]\);/,
  `// Removed localStorage wipe`
);

fs.writeFileSync('src/App.jsx', code);
console.log('Restored chat persistence.');
