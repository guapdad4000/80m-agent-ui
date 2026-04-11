const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf-8');

// Add agentThinking state
code = code.replace(
  /const \[agentState, setAgentState\] = useState\('default'\);/,
  `const [agentState, setAgentState] = useState('default');
  const [agentThinking, setAgentThinking] = useState(false);`
);

fs.writeFileSync('src/App.jsx', code);
console.log('Added agentThinking state');
