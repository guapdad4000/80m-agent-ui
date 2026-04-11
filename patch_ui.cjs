const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf-8');

// The issue: when we submit a job, we insert an empty assistant message right away.
// That empty message renders a bubble.
// We should only render assistant messages if they have content OR if they have tool events.

code = code.replace(
  /\{messages\.map\(\(msg, index\) => \(\n\s*<motion\.div/m,
  `{messages.filter(msg => msg.role !== 'assistant' || msg.content || (toolEventsByMsg[msg.id] && toolEventsByMsg[msg.id].length > 0) || agentThinking).map((msg, index) => (
                    <motion.div`
);

// We need to hide the empty bubble itself when there's no content yet, but we want to show a loading state if thinking
code = code.replace(
  /<p className="font-mono text-base lg:text-lg leading-relaxed whitespace-pre-wrap tracking-tight">\{msg\.content\}<\/p>/g,
  `{msg.content ? (
                          <p className="font-mono text-base lg:text-lg leading-relaxed whitespace-pre-wrap tracking-tight">{msg.content}</p>
                        ) : agentThinking && index === messages.length - 1 ? (
                          <div className="flex items-center gap-2 text-[#888]"><Activity size={14} className="animate-pulse" /> <span className="font-mono text-[10px] uppercase tracking-widest">Processing...</span></div>
                        ) : null}`
);


// And for the buggy hover tooltip on the agent icon, let's fix the z-index and opacity structure
code = code.replace(
  /<div className="absolute -top-4 -left-4 -rotate-12 group">\n\s*<Bot size=\{18\} strokeWidth=\{2\} className="text-\[#22c55e\] drop-shadow-\[0_2px_8px_rgba\(34,197,94,0\.4\)\]" \/>\n\s*<div className="absolute bottom-full left-0 mb-1 px-2 py-1 bg-\[#1c1c1e\] border border-\[#3a3a3e\] shadow-\[2px_2px_0_0_#22c55e\]\/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">\n\s*<p className="font-mono text-\[8px\] font-black uppercase text-\[#22c55e\]">\{msg\.employee\}_V4<\/p>\n\s*<\/div>\n\s*<\/div>/,
  `<div className="absolute -top-4 -left-4 -rotate-12 group z-50 cursor-help">
                          <Bot size={18} strokeWidth={2} className="text-[#22c55e] drop-shadow-[0_2px_8px_rgba(34,197,94,0.4)]" />
                          <div className="absolute bottom-full left-0 mb-2 px-2 py-1 bg-[#1c1c1e] border-[2px] border-[#3a3a3e] shadow-[2px_2px_0_0_#22c55e] opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 whitespace-nowrap z-[100] pointer-events-none">
                            <p className="font-mono text-[8px] font-black uppercase text-[#22c55e]">{msg.employee}_V4</p>
                          </div>
                        </div>`
);

fs.writeFileSync('src/App.jsx', code);
console.log('Patched UI for empty messages and hover.');
