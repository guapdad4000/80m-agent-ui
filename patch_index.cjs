const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf-8');

code = code.replace(
  /\{messages\.map\(\(msg\) => \(/,
  `{messages.filter(msg => msg.role !== 'assistant' || msg.content || (toolEventsByMsg[msg.id] && toolEventsByMsg[msg.id].length > 0) || agentThinking).map((msg, index, filteredArr) => (`
);

// We should also change messages.length - 1 to filteredArr.length - 1 in the JSX.
code = code.replace(
  /\) : agentThinking && index === messages\.length - 1 \? \(/,
  `) : agentThinking && index === filteredArr.length - 1 ? (`
);

fs.writeFileSync('src/App.jsx', code);
console.log('Fixed index error.');
