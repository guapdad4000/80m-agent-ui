const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf-8');

// 1. Restore loadMessages
code = code.replace(
  /const loadMessages = \(\) => \[\];/,
  `const loadMessages = () => {
  try {
    const saved = localStorage.getItem('80m-agent-messages');
    if (saved) return JSON.parse(saved);
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
if (!code.includes('saveMessages(messages);')) {
  code = code.replace(
    /const \[inputValue, setInputValue\] = useState\(''\);/,
    `const [inputValue, setInputValue] = useState('');

  // Sync messages to local storage
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);`
  );
}

// Ensure the initial state of messages uses loadMessages
if (code.includes('const [messages, setMessages] = useState([]);')) {
  code = code.replace(
    /const \[messages, setMessages\] = useState\(\[\]\);/,
    `const [messages, setMessages] = useState(() => loadMessages());`
  );
}

fs.writeFileSync('src/App.jsx', code);
console.log('Restored chat persistence.');
