const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf-8');

// The issue is that the msg.id might be duplicated or not fully unique due to earlier patches where Date.now() was used for the ID, causing React reconciliation to fail.
// We should update the mapping to use a truly unique combination for the key if we are rendering.

code = code.replace(
  /key=\{msg\.id\}/,
  `key={msg.id + '-' + index}`
);

fs.writeFileSync('src/App.jsx', code);
console.log('Fixed duplicate keys issue.');
