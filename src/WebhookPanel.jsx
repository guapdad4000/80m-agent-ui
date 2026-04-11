import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Trash2, Plus, X, ExternalLink, CheckCircle2, XCircle, Globe, Clock } from 'lucide-react';
import { getHermesBase, getWebhookBase } from './config/endpoints';

const WEBHOOK_API = getWebhookBase();
const HERMES_BASE = getHermesBase();

export default function WebhookPanel({ onClose }) {
  const [webhooks, setWebhooks] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', agent: 'Hermes', endpoint: `${HERMES_BASE}/chat`, secret: '' });

  const fetchWebhooks = () => {
    setLoading(true);
    fetch(`${WEBHOOK_API}/webhooks`)
      .then(r => r.json())
      .then(d => { setWebhooks(d.webhooks || []); setLogs(d.logs || []); })
      .catch(() => setWebhooks([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchWebhooks(); }, []);

  const registerWebhook = async () => {
    if (!form.name.trim()) return;
    await fetch(`${WEBHOOK_API}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setForm({ name: '', url: '', agent: 'Hermes', endpoint: `${HERMES_BASE}/chat`, secret: '' });
    setShowAdd(false);
    fetchWebhooks();
  };

  const deleteWebhook = async (id) => {
    await fetch(`${WEBHOOK_API}/webhooks/${id}`, { method: 'DELETE' });
    fetchWebhooks();
  };

  const toggleWebhook = async (wh) => {
    await fetch(`${WEBHOOK_API}/webhooks/${wh.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !wh.enabled }),
    });
    fetchWebhooks();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="border-[3px] border-[#111] bg-white shadow-[6px_6px_0_0_#111] p-4 max-w-2xl mx-auto max-h-[80vh] flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[#111]" />
          <span className="font-mono text-[10px] font-black uppercase">Webhook_Triggers</span>
          <span className="font-mono text-[8px] text-[#aaa]">port:5176</span>
        </div>
        <div className="flex items-center gap-2">
          {!showAdd && (
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 px-3 py-1.5 bg-[#22c55e] text-[#111] border-[2px] border-[#111] font-mono text-[9px] font-black hover:bg-[#111] hover:text-[#22c55e] transition-colors">
              <Plus size={10} /> ADD
            </button>
          )}
          <button onClick={onClose} className="p-1 hover:text-[#ef4444] transition-colors"><X size={14} /></button>
        </div>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-4">
            <div className="p-3 border-[3px] border-[#111] bg-[#f5f5f0] space-y-2">
              <div className="flex items-center gap-2">
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Webhook name (e.g. GitHub PR)" className="flex-1 bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]" />
              </div>
              <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="External webhook URL to register (optional)" className="w-full bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]" />
              <div className="flex items-center gap-2">
                <input value={form.agent} onChange={e => setForm(f => ({ ...f, agent: e.target.value }))} placeholder="Agent name" className="flex-1 bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]" />
                <input value={form.endpoint} onChange={e => setForm(f => ({ ...f, endpoint: e.target.value }))} placeholder="Chat endpoint" className="flex-[2] bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]" />
              </div>
              <div className="flex items-center gap-2">
                <input value={form.secret} onChange={e => setForm(f => ({ ...f, secret: e.target.value }))} placeholder="Secret (for validation)" className="flex-1 bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]" />
                <button onClick={registerWebhook} className="px-4 py-1.5 bg-[#22c55e] text-[#111] border-[2px] border-[#111] font-mono text-[9px] font-black hover:bg-[#111] hover:text-[#22c55e] transition-colors">REGISTER</button>
                <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 bg-white text-[#111] border-[2px] border-[#111] font-mono text-[9px] font-black hover:bg-[#ef4444] hover:text-white transition-colors">CANCEL</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Webhook list */}
      <div className="flex-1 overflow-y-auto space-y-2 mb-3 custom-scrollbar">
        {webhooks.length === 0 && !loading && (
          <div className="text-center py-8">
            <Globe size={24} className="mx-auto text-[#ddd] mb-2" />
            <p className="font-mono text-[9px] text-[#aaa] uppercase">No webhooks registered</p>
            <p className="font-mono text-[8px] text-[#ccc] mt-1">Add one above to start receiving external events</p>
          </div>
        )}
        {webhooks.map(wh => (
          <div key={wh.id} className={`flex items-start gap-3 p-3 border-[3px] ${wh.enabled ? 'border-[#111] bg-white' : 'border-[#ddd] bg-[#f5f5f0] opacity-60'}`}>
            <button onClick={() => toggleWebhook(wh)} className="mt-0.5">
              {wh.enabled
                ? <CheckCircle2 size={14} className="text-[#22c55e]" />
                : <XCircle size={14} className="text-[#aaa]" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-black uppercase">{wh.name}</span>
                {wh.enabled
                  ? <span className="font-mono text-[7px] bg-[#22c55e] text-[#111] px-1.5 py-0.5 font-black">ACTIVE</span>
                  : <span className="font-mono text-[7px] bg-[#ddd] text-[#666] px-1.5 py-0.5 font-black">DISABLED</span>}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Zap size={8} className="text-[#aaa]" />
                <span className="font-mono text-[8px] text-[#666]">{wh.agent}</span>
                <ExternalLink size={8} className="text-[#aaa] ml-2" />
                <span className="font-mono text-[7px] text-[#aaa] truncate">{wh.endpoint}</span>
              </div>
              {wh.url && (
                <div className="mt-1 flex items-center gap-1">
                  <Globe size={8} className="text-[#aaa]" />
                  <span className="font-mono text-[7px] text-[#aaa] truncate">{wh.url}</span>
                </div>
              )}
            </div>
            <div className="text-xs font-mono text-[#aaa] flex-shrink-0">
              #{wh.id}
            </div>
            <button onClick={() => deleteWebhook(wh.id)} className="text-[#ef4444] hover:text-[#111] transition-colors flex-shrink-0"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>

      {/* Recent log */}
      {logs.length > 0 && (
        <div className="border-t-[3px] border-[#111] pt-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={10} className="text-[#aaa]" />
            <span className="font-mono text-[8px] font-black uppercase text-[#888]">Recent_Activity</span>
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1 custom-scrollbar">
            {logs.slice(0, 20).map((log, i) => (
              <p key={i} className="font-mono text-[7px] text-[#666] whitespace-pre-wrap break-all">{log}</p>
            ))}
          </div>
        </div>
      )}

      {/* Trigger URL */}
      <div className="mt-3 pt-3 border-t-[2px] border-[#ddd]">
        <p className="font-mono text-[7px] text-[#888] uppercase mb-1">Receive-Webhook-Endpoint</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 font-mono text-[8px] bg-[#f5f5f0] border-[2px] border-[#ddd] px-2 py-1 text-[#111] truncate">
            {WEBHOOK_API}/webhooks/trigger
          </code>
          <button onClick={() => navigator.clipboard.writeText(`${WEBHOOK_API}/webhooks/trigger`)} className="px-2 py-1 bg-[#111] text-[#eae7de] border-[2px] border-[#111] font-mono text-[7px] hover:bg-[#22c55e] hover:text-[#111] transition-colors">COPY</button>
        </div>
        <p className="font-mono text-[7px] text-[#aaa] mt-1">Set this as your external webhook URL. Send POST with <code className="bg-[#eee] px-1">X-Webhook-Secret</code> header to validate.</p>
      </div>
    </motion.div>
  );
}
