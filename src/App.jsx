// 80m Agent Control — Mission Control Interface
// Original UI preserved exactly. New features are additive only.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'framer-motion';
import WebhookPanel from './WebhookPanel';
import {
  Send,
  Terminal,
  User,
  Bot,
  RefreshCcw,
  Zap,
  Database,
  MoreVertical,
  Activity,
  Search,
  PenTool,
  CheckCircle2,
  Clock,
  MessageSquare,
  Settings,
  X,
  ChevronRight,
  Plug,
  Save,
  Upload,
  Download,
  Info,
  Wifi,
  WifiOff,
  ExternalLink,
  Copy,
  Check,
  Trash2,
  Plus,
  Eye,
  Brain,
  Globe,
  Folder,
  RefreshCw,
  FileText,
  Keyboard,
  List,
  Cpu,
  UserCircle,
  Tag,
  Clock3,
} from 'lucide-react';
import useHermesApi from './hooks/useHermesApi';
import useOffline from './hooks/useOffline';
import ShareHandler from './ShareHandler';
import { getQueue, processQueue, queueMessage } from './offlineQueue';
import { buildApiPayload, extractAssistantText } from './lib/chatTransport';
import { getHermesBase, getLocalApiBase, getWebhookBase, getEndpointConfig, setEndpointConfig } from './config/endpoints';

// =====================================================================
// USE AUDIO HOOK — Web Audio API for subtle UI sounds
// =====================================================================
const useAudio = () => {
  const ctxRef = useRef(null);
  const unlockedRef = useRef(false);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctxRef.current;
  }, []);

  // Unlock AudioContext on first user gesture
  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    unlockedRef.current = true;
  }, [getCtx]);

  // Soft envelope helper
  const env = (ctx, gainNode, attack, decay, sustain, release, duration) => {
    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + attack);
    gainNode.gain.linearRampToValueAtTime(sustain, now + attack + decay);
    gainNode.gain.setValueAtTime(sustain, now + duration - release);
    gainNode.gain.linearRampToValueAtTime(0, now + duration);
  };

  // Send click — 50ms triangle wave at 880Hz, gain 0.08
  const playSendClick = useCallback(() => {
    if (!unlockedRef.current) return;
    try {
      const ctx = getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    } catch (_) {}
  }, [getCtx]);

  // Agent chime — 2-tone sequence: C5 (523Hz) then E5 (659Hz), 80ms each, 40ms gap
  const playAgentChime = useCallback(() => {
    if (!unlockedRef.current) return;
    try {
      const ctx = getCtx();
      const now = ctx.currentTime;

      const tone = (freq, startTime, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.1, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      tone(523, now, 0.08);
      tone(659, now + 0.12, 0.08);
    } catch (_) {}
  }, [getCtx]);

  return { unlock, playSendClick, playAgentChime };
};

// =====================================================================
// WAVEFORM INDICATOR — canvas-based animated bars
// =====================================================================
const WaveformIndicator = ({ agentState, isRecording, agentThinking }) => {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const isActive = isRecording || agentThinking || ['processing', 'typing', 'searching', 'urgent'].includes(agentState);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 44, H = 20;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    let startTime = null;
    const BAR_COUNT = 6;
    const BAR_W = 4;
    const GAP = 3;
    const TOTAL_W = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * GAP;
    const START_X = (W - TOTAL_W) / 2;
    const CENTER_Y = H / 2;

    const draw = (ts) => {
      if (!startTime) startTime = ts;
      const elapsed = (ts - startTime) / 1000;
      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < BAR_COUNT; i++) {
        const x = START_X + i * (BAR_W + GAP);
        let barH;

        if (isActive) {
          // Sine wave animation — each bar has a phase offset
          const phase = (i / BAR_COUNT) * Math.PI * 2;
          const sineVal = Math.sin(elapsed * 4 + phase);
          // Map sine from [-1,1] to [1,8] — minimum 1 so bars are always visible
          barH = 1 + (sineVal + 1) * 3.5;
          const opacity = 0.4 + ((sineVal + 1) / 2) * 0.6;
          ctx.fillStyle = `rgba(34, 197, 94, ${opacity})`;
        } else {
          // Collapsed to flat line
          barH = 1;
          ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
        }

        const y = CENTER_Y - barH / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_W, barH, 1);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive]);

  return (
    <canvas
      ref={canvasRef}
      width={44 * window.devicePixelRatio}
      height={20 * window.devicePixelRatio}
      style={{ width: 44, height: 20 }}
      className={`transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-30'}`}
    />
  );
};

// =====================================================================
// DEFAULT AGENT CONFIG — user-configurable via Settings
// =====================================================================
const HERMES_BASE = getHermesBase();
const LOCAL_API_BASE = getLocalApiBase();
const WEBHOOK_BASE = getWebhookBase();
const HERMES_HTTP = HERMES_BASE;
const DEFAULT_CONFIG = {
  apiEndpoint: `${HERMES_BASE}/chat`,
  apiEnabled: true,
  agents: [
    { id: 'prawnius', icon: 'Bot', role: 'Quick Tasks', color: '#22c55e' },
    { id: 'claudnelius', icon: 'PenTool', role: 'Code & Design', color: '#3b82f6' },
    { id: 'knowledge_knaight', icon: 'Search', role: 'Research', color: '#f59e0b' },
    { id: 'clawdette', icon: 'CheckCircle2', role: 'Operations', color: '#ef4444' },
  ],
  welcomeMessage: '',
  showPWAInstall: true,
};

const ICON_MAP = {
  Bot, Search, PenTool, CheckCircle2, Zap, Database, Activity, Clock, MessageSquare, Settings,
};

// =====================================================================
// CONFIG STORAGE HELPERS
// =====================================================================
const loadConfig = () => {
  try {
    const saved = localStorage.getItem('80m-agent-config');
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
};

const saveConfig = (config) => {
  localStorage.setItem('80m-agent-config', JSON.stringify(config));
};

// =====================================================================
// TIME FORMATTING
// =====================================================================
const formatRelativeTime = (timestamp) => {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const tryStreamJobViaSSE = async ({ baseUrl, jobId, timeoutMs = 15000 }) => {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return null;

  const candidates = [
    `${baseUrl}/chat/stream/${encodeURIComponent(jobId)}`,
    `${baseUrl}/chat/stream?job_id=${encodeURIComponent(jobId)}`,
  ];

  for (const url of candidates) {
    const result = await new Promise((resolve) => {
      let settled = false;
      let hasTraffic = false;
      let responseText = '';
      const toolEvents = [];
      let es;
      let timer;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { es?.close(); } catch (_) {}
        resolve(value);
      };

      es = new EventSource(url);
      timer = setTimeout(() => finish(null), timeoutMs);

      es.onmessage = (event) => {
        hasTraffic = true;
        const data = event?.data;
        if (!data) return;
        if (data === '[DONE]') {
          finish({ completed: true, responseText: responseText.trim(), events: toolEvents });
          return;
        }

        try {
          const parsed = JSON.parse(data);
          if (parsed.status === 'failed') {
            finish({ failed: true, error: parsed.error || parsed.result?.error || 'Hermes job failed' });
            return;
          }
          if (Array.isArray(parsed.events)) {
            toolEvents.push(...parsed.events.filter(e => e?.type === 'tool'));
          }
          if (parsed.type === 'tool') toolEvents.push(parsed);

          const delta = parsed.delta || parsed.token || parsed.text || '';
          if (delta) responseText += delta;
          if (parsed.response) responseText = parsed.response;

          if (parsed.status === 'completed') {
            finish({ completed: true, responseText: (parsed.response || responseText || '').trim(), events: toolEvents });
          }
        } catch {
          responseText += String(data);
        }
      };

      es.onerror = () => {
        if (hasTraffic) {
          finish({ completed: false, partial: true, responseText: responseText.trim(), events: toolEvents });
        } else {
          finish(null);
        }
      };
    });

    if (result?.failed) throw new Error(result.error || 'Hermes stream failed');
    if (result?.completed) return result;
  }

  return null;
};

// =====================================================================
// PERSISTENCE HELPERS
// =====================================================================
const loadMessages = () => {
  try {
    const saved = localStorage.getItem('80m-agent-messages');
    if (saved) {
      const msgs = JSON.parse(saved);
      // Filter out phantom ping/acknowledge pairs that come from connectivity checks
      // These are identifiable: user msg contains "ping" or "acknowledge", followed by
      // an assistant msg containing "acknowledge" — and they happened close together
      const cleaned = msgs.filter((msg, i) => {
        const prev = msgs[i - 1];
        const isPingUser = msg.role === 'user' &&
          (msg.content?.toLowerCase().includes('ping') ||
           msg.content?.toLowerCase().includes('acknowledge'));
        const isAckAssistant = msg.role === 'assistant' &&
          msg.content?.toLowerCase().includes('acknowledge');
        const isPongPair = prev && isPingUser && isAckAssistant &&
          (msg.id - prev.id) < 10000; // within 10 seconds
        return !isPongPair;
      });
      return cleaned;
    }
  } catch {}
  return [];
};

const saveMessages = (msgs) => {
  try {
    localStorage.setItem('80m-agent-messages', JSON.stringify(msgs.slice(-100)));
  } catch {}
};

// Ref to always hold the latest messages — bypasses React batching/async issues
let _messagesRef = null;
const _setMessagesRef = (msgs) => { _messagesRef = msgs; };

// Flush to localStorage on every message update — synchronous, no batching
const flushMessages = () => {
  if (_messagesRef !== null) saveMessages(_messagesRef);
};

// Sync flush on page hide/close (covers nativefier, PWA backgrounding, tab switch)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushMessages();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushMessages);
  window.addEventListener('beforeunload', flushMessages);
}

// =====================================================================
// PWA INSTALL HELPERS
// =====================================================================
let deferredPrompt = null;
const handlePWAInstallAvailable = (e) => {
  deferredPrompt = e;
};
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', handlePWAInstallAvailable);
}

// =====================================================================
// SETTINGS PANEL COMPONENT (additive — slides over UI, doesn't modify it)
// =====================================================================
const SettingsPanel = ({ config, onSave, onClose }) => {
  const [localConfig, setLocalConfig] = useState(config);
  const [activeTab, setActiveTab] = useState('connection');
  const [saveStatus, setSaveStatus] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [endpointConfig, setLocalEndpointConfig] = useState(getEndpointConfig);
  const [endpointStatus, setEndpointStatus] = useState('');
  const [endpointChecks, setEndpointChecks] = useState([]);
  const [tailnetHost, setTailnetHost] = useState('');
  const [tailscalePort, setTailscalePort] = useState('5190');
  const [tailscaleScheme, setTailscaleScheme] = useState('http');
  const [tailscaleHint, setTailscaleHint] = useState('');

  const handleSave = () => {
    onSave(localConfig);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus(''), 2000);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(localConfig, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '80m-agent-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          setLocalConfig({ ...DEFAULT_CONFIG, ...parsed });
        } catch {
          alert('Invalid config file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleTestConnection = async () => {
    if (!localConfig.apiEndpoint) {
      setTestResult({ ok: false, message: 'No endpoint configured' });
      return;
    }
    setTestResult({ ok: null, message: 'Testing...' });
    try {
      const res = await fetch(localConfig.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'ping', agent_id: activeEmployee }),
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      setTestResult({ ok: res.ok, message: `HTTP ${res.status}: ${text.slice(0, 80)}` });
    } catch (err) {
      setTestResult({ ok: false, message: err.message || 'Connection failed' });
    }
  };

  const handleSaveEndpoints = () => {
    setEndpointConfig(endpointConfig);
    setEndpointStatus('saved');
    setTimeout(() => setEndpointStatus(''), 2500);
  };

  const applyTailscaleEndpoint = () => {
    const host = tailnetHost.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!host) {
      setTailscaleHint('Enter your Tailnet hostname first (example: macbook.tailnet.ts.net)');
      return;
    }
    const endpoint = `${tailscaleScheme}://${host}:${tailscalePort}/chat`;
    setLocalConfig(prev => ({ ...prev, apiEndpoint: endpoint }));
    setTailscaleHint(`Applied API endpoint: ${endpoint}`);
  };

  const copyMobileUrl = async () => {
    const host = tailnetHost.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!host) {
      setTailscaleHint('Enter your Tailnet hostname to copy mobile URL');
      return;
    }
    const mobileUrl = `${tailscaleScheme}://${host}:${tailscalePort}`;
    try {
      await navigator.clipboard.writeText(mobileUrl);
      setTailscaleHint(`Copied mobile URL: ${mobileUrl}`);
    } catch {
      setTailscaleHint(`Copy failed. Use this URL manually: ${mobileUrl}`);
    }
  };

  const handleTestAllEndpoints = async () => {
    const checks = [
      { name: 'Hermes /sessions', url: `${endpointConfig.hermesBase}/sessions` },
      { name: 'Local API /fs/list', url: `${endpointConfig.localApiBase}/fs/list?path=/` },
      { name: 'Webhook /webhooks', url: `${endpointConfig.webhookBase}/webhooks` },
    ];
    const results = [];
    for (const check of checks) {
      const started = performance.now();
      try {
        const res = await fetch(check.url, { signal: AbortSignal.timeout(5000) });
        results.push({ ...check, ok: res.ok, status: res.status, ms: Math.round(performance.now() - started) });
      } catch (err) {
        results.push({ ...check, ok: false, status: 'ERR', ms: Math.round(performance.now() - started), error: err.message });
      }
    }
    setEndpointChecks(results);
  };

  const BEHAVIOR_PRESETS = [
    { value: 'focused', label: 'FOCUSED — task-oriented, minimal chatter' },
    { value: 'chatty', label: 'CHATTY — verbose, explains reasoning' },
    { value: 'silent', label: 'SILENT — terse responses only' },
    { value: 'creative', label: 'CREATIVE — exploratory, brainstorming' },
    { value: 'technical', label: 'TECHNICAL — precise, code-first' },
  ];

  // Profile presets for named agent configurations
  const [profiles, setProfiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem('80m-agent-profiles')) || []; } catch { return []; }
  });
  const [profileName, setProfileName] = useState('');

  const addAgent = () => {
    const id = `Agent_${Date.now()}`;
    setLocalConfig(prev => ({
      ...prev,
      agents: [...prev.agents, { id, icon: 'Bot', role: 'New Agent', color: '#888888', systemPrompt: '', avatarEmoji: '', behavior: 'focused' }],
    }));
  };

  const removeAgent = (id) => {
    if (localConfig.agents.length <= 1) return;
    setLocalConfig(prev => ({ ...prev, agents: prev.agents.filter(a => a.id !== id) }));
  };

  const updateAgent = (id, field, value) => {
    setLocalConfig(prev => ({
      ...prev,
      agents: prev.agents.map(a => a.id === id ? { ...a, [field]: value } : a),
    }));
  };

  const saveProfile = () => {
    if (!profileName.trim()) { alert('Enter a profile name'); return; }
    const newProfile = { id: Date.now().toString(36), name: profileName.trim(), agents: JSON.parse(JSON.stringify(localConfig.agents)) };
    setProfiles(prev => { const updated = [...prev.filter(p => p.name !== newProfile.name), newProfile]; localStorage.setItem('80m-agent-profiles', JSON.stringify(updated)); return updated; });
    setProfileName('');
  };

  const loadProfile = (profileId) => {
    const profile = profiles.find(p => p.id === profileId);
    if (profile) setLocalConfig(prev => ({ ...prev, agents: JSON.parse(JSON.stringify(profile.agents)) }));
  };

  const deleteProfile = (profileId) => {
    setProfiles(prev => { const updated = prev.filter(p => p.id !== profileId); localStorage.setItem('80m-agent-profiles', JSON.stringify(updated)); return updated; });
  };

  const exportProfile = (profile) => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `80m-profile-${profile.name}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importProfile = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (parsed.agents) {
            setProfiles(prev => { const updated = [...prev, { ...parsed, id: Date.now().toString(36) }]; localStorage.setItem('80m-agent-profiles', JSON.stringify(updated)); return updated; });
          } else { alert('Invalid profile file'); }
        } catch { alert('Invalid JSON file'); }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const tabs = [
    { id: 'connection', label: 'Connection', icon: <Plug size={14} /> },
    { id: 'agents', label: 'Agents', icon: <Bot size={14} /> },
    { id: 'templates', label: 'Templates', icon: <FileText size={14} /> },
    { id: 'hotkeys', label: 'Hotkeys', icon: <Keyboard size={14} /> },
    { id: 'config', label: 'Config', icon: <Settings size={14} /> },
    { id: 'about', label: 'About', icon: <Info size={14} /> },
  ];

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed inset-y-0 right-0 w-full max-w-md bg-[#eae7de] border-l-[4px] border-[#111] z-[200] flex flex-col shadow-[-10px_0_40px_rgba(0,0,0,0.3)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b-[4px] border-[#111] bg-[#111]">
        <div className="flex items-center gap-3">
          <Settings size={18} className="text-[#22c55e]" />
          <span className="font-serif font-black text-xl text-[#eae7de] tracking-tight">AGENT_CONFIG</span>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus && (
            <span className="font-mono text-[10px] text-[#22c55e] animate-pulse">
              {saveStatus === 'saved' ? '● SAVED' : ''}
            </span>
          )}
          <button onClick={onClose} className="p-2 text-[#eae7de] hover:text-[#22c55e] transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b-[3px] border-[#111]">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[10px] font-black uppercase tracking-tight transition-colors border-r-[2px] border-[#111] last:border-r-0 ${
              activeTab === tab.id ? 'bg-[#111] text-[#22c55e]' : 'bg-[#eae7de] text-[#111] hover:bg-[#ddd]'
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* CONNECTION TAB */}
        {activeTab === 'connection' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 font-mono text-[9px] font-black uppercase tracking-[0.15em] text-[#111]">
                <Plug size={12} /> API Endpoint
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={localConfig.apiEndpoint}
                  onChange={e => setLocalConfig(p => ({ ...p, apiEndpoint: e.target.value }))}
                  placeholder={`${HERMES_BASE}/chat`}
                  className="flex-1 bg-white border-[3px] border-[#111] px-3 py-2 font-mono text-xs focus:outline-none focus:shadow-[4px_4px_0_0_#111]"
                />
                <button
                  onClick={handleTestConnection}
                  className="px-4 py-2 border-[3px] border-[#111] bg-[#111] text-[#22c55e] font-mono text-[10px] font-black uppercase hover:bg-[#222] transition-colors"
                >
                  TEST
                </button>
              </div>
              {testResult && (
                <div className={`mt-2 p-2 border-[2px] border-[#111] font-mono text-[10px] ${
                  testResult.ok === true ? 'bg-[#dcfce7] text-[#166534]' :
                  testResult.ok === false ? 'bg-[#fee2e2] text-[#991b1b]' : 'bg-[#fef9c3] text-[#854d0e]'
                }`}>
                  {testResult.message}
                </div>
              )}
              <p className="font-mono text-[8px] text-[#666]">
                Leave empty or disable to use demo mode (simulated responses)
              </p>
            </div>

            <div className="p-3 border-[3px] border-[#111] bg-[#f5f5f0] space-y-2">
              <div className="flex items-center gap-2">
                <Globe size={12} />
                <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[#111]">Tailscale Mobile Helper</p>
              </div>
              <input
                value={tailnetHost}
                onChange={e => setTailnetHost(e.target.value)}
                placeholder="hostname.tailnet.ts.net"
                className="w-full bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={tailscaleScheme}
                  onChange={e => setTailscaleScheme(e.target.value)}
                  className="w-full bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]"
                >
                  <option value="http">http</option>
                  <option value="https">https</option>
                </select>
                <input
                  value={tailscalePort}
                  onChange={e => setTailscalePort(e.target.value)}
                  placeholder="5190"
                  className="w-full bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={applyTailscaleEndpoint}
                  className="px-3 py-1.5 border-[2px] border-[#111] bg-[#111] text-[#22c55e] font-mono text-[9px] font-black uppercase hover:bg-[#222]"
                >
                  Use for API
                </button>
                <button
                  onClick={copyMobileUrl}
                  className="inline-flex items-center gap-1 px-3 py-1.5 border-[2px] border-[#111] bg-white text-[#111] font-mono text-[9px] font-black uppercase hover:bg-[#eee]"
                >
                  <Copy size={10} />
                  Copy Mobile URL
                </button>
              </div>
              {tailscaleHint && <p className="font-mono text-[8px] text-[#555]">{tailscaleHint}</p>}
              <p className="font-mono text-[7px] text-[#777]">Tip: keep this as http on Tailnet; use https only when serving through Funnel/TLS.</p>
            </div>

            <div className="p-3 border-[3px] border-[#111] bg-[#f5f5f0] space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[#111]">Service Endpoints</p>
                {endpointStatus === 'saved' && <span className="font-mono text-[8px] font-black text-[#22c55e]">SAVED</span>}
              </div>
              <input
                value={endpointConfig.hermesBase}
                onChange={e => setLocalEndpointConfig(prev => ({ ...prev, hermesBase: e.target.value }))}
                placeholder="Hermes base URL"
                className="w-full bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]"
              />
              <input
                value={endpointConfig.localApiBase}
                onChange={e => setLocalEndpointConfig(prev => ({ ...prev, localApiBase: e.target.value }))}
                placeholder="Local API base URL"
                className="w-full bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]"
              />
              <input
                value={endpointConfig.webhookBase}
                onChange={e => setLocalEndpointConfig(prev => ({ ...prev, webhookBase: e.target.value }))}
                placeholder="Webhook base URL"
                className="w-full bg-white border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveEndpoints}
                  className="px-3 py-1.5 border-[2px] border-[#111] bg-[#111] text-[#22c55e] font-mono text-[9px] font-black uppercase hover:bg-[#222]"
                >
                  Save Endpoints
                </button>
                <button
                  onClick={handleTestAllEndpoints}
                  className="px-3 py-1.5 border-[2px] border-[#111] bg-white text-[#111] font-mono text-[9px] font-black uppercase hover:bg-[#eee]"
                >
                  Test All
                </button>
              </div>
              {endpointChecks.length > 0 && (
                <div className="space-y-1 pt-1">
                  {endpointChecks.map((check, idx) => (
                    <p key={idx} className={`font-mono text-[8px] ${check.ok ? 'text-[#166534]' : 'text-[#991b1b]'}`}>
                      {check.ok ? '✅' : '❌'} {check.name} — {check.status} ({check.ms}ms){check.error ? ` — ${check.error}` : ''}
                    </p>
                  ))}
                </div>
              )}
              <p className="font-mono text-[7px] text-[#777]">Reload app after saving so all modules use new endpoint values.</p>
            </div>

            <div className="flex items-center justify-between p-3 border-[3px] border-[#111] bg-white">
              <div className="flex items-center gap-2">
                {localConfig.apiEnabled ? (
                  <Wifi size={14} className="text-[#22c55e]" />
                ) : (
                  <WifiOff size={14} className="text-[#999]" />
                )}
                <span className="font-mono text-[10px] font-black uppercase">
                  API {localConfig.apiEnabled ? 'ENABLED' : 'DISABLED'}
                </span>
              </div>
              <button
                onClick={() => setLocalConfig(p => ({ ...p, apiEnabled: !p.apiEnabled }))}
                className={`w-12 h-6 border-[2px] border-[#111] rounded-none transition-colors relative ${
                  localConfig.apiEnabled ? 'bg-[#22c55e]' : 'bg-[#ddd]'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-[#111] transition-all ${
                  localConfig.apiEnabled ? 'left-6' : 'left-0.5'
                }`} />
              </button>
            </div>

            <div className="space-y-2">
              <label className="font-mono text-[9px] font-black uppercase tracking-[0.15em]">
                Welcome Message
              </label>
              <textarea
                value={localConfig.welcomeMessage}
                onChange={e => setLocalConfig(p => ({ ...p, welcomeMessage: e.target.value }))}
                rows={3}
                className="w-full bg-white border-[3px] border-[#111] px-3 py-2 font-mono text-xs focus:outline-none focus:shadow-[4px_4px_0_0_#111] resize-none"
              />
            </div>
          </div>
        )}

        {/* AGENTS TAB */}
        {activeTab === 'agents' && (
          <div className="space-y-3">
            {/* Profile presets */}
            <div className="p-3 border-[3px] border-[#22c55e] bg-white space-y-2">
              <p className="font-mono text-[9px] font-black uppercase text-[#555]">PROFILE_PRESETS</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  placeholder="Profile name..."
                  className="flex-1 bg-[#f5f5f0] border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]"
                  onKeyDown={e => e.key === 'Enter' && saveProfile()}
                />
                <button onClick={saveProfile} className="px-3 py-1.5 bg-[#22c55e] text-[#111] border-[2px] border-[#111] font-mono text-[9px] font-black uppercase hover:bg-[#111] hover:text-[#22c55e] transition-colors">
                  <Save size={10} />
                </button>
              </div>
              {profiles.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {profiles.map(p => (
                    <div key={p.id} className="flex items-center gap-1 px-2 py-1 bg-[#f5f5f0] border-[2px] border-[#ddd]">
                      <span className="font-mono text-[8px] font-black uppercase">{p.name}</span>
                      <button onClick={() => loadProfile(p.id)} className="text-[#22c55e] hover:text-[#111] transition-colors"><Check size={8} /></button>
                      <button onClick={() => exportProfile(p)} className="text-[#888] hover:text-[#111] transition-colors"><Download size={8} /></button>
                      <button onClick={() => deleteProfile(p.id)} className="text-[#ef4444] hover:text-[#111] transition-colors"><Trash2 size={8} /></button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={importProfile} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white border-[2px] border-[#111] font-mono text-[8px] font-black uppercase hover:bg-[#111] hover:text-[#eae7de] transition-colors">
                <Upload size={10} /> IMPORT PROFILE
              </button>
            </div>

            <div className="flex items-center justify-between">
              <p className="font-mono text-[9px] font-black uppercase text-[#555]">AGENT_COUNCIL_MEMBERS</p>
              <button
                onClick={addAgent}
                className="flex items-center gap-1 px-3 py-1.5 border-[2px] border-[#111] bg-[#22c55e] text-[#111] font-mono text-[9px] font-black uppercase hover:bg-[#111] hover:text-[#22c55e] transition-colors"
              >
                <Plus size={12} /> ADD
              </button>
            </div>
            {localConfig.agents.map(agent => (
              <div key={agent.id} className="p-3 border-[3px] border-[#111] bg-white space-y-2">
                <div className="flex items-center justify-between">
                  <input
                    value={agent.id}
                    onChange={e => updateAgent(agent.id, 'id', e.target.value)}
                    className="font-sans font-black text-sm bg-transparent border-b border-[#ddd] focus:outline-none focus:border-[#111]"
                  />
                  <button
                    onClick={() => removeAgent(agent.id)}
                    className="p-1 text-[#ef4444] hover:bg-[#fee2e2] transition-colors"
                    disabled={localConfig.agents.length <= 1}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-mono text-[7px] uppercase opacity-50">Role</label>
                    <input
                      value={agent.role}
                      onChange={e => updateAgent(agent.id, 'role', e.target.value)}
                      className="w-full font-mono text-[10px] bg-[#f5f5f0] border-[2px] border-[#ddd] px-2 py-1 focus:outline-none focus:border-[#111]"
                    />
                  </div>
                  <div>
                    <label className="font-mono text-[7px] uppercase opacity-50">Color</label>
                    <input
                      type="color"
                      value={agent.color}
                      onChange={e => updateAgent(agent.id, 'color', e.target.value)}
                      className="w-full h-[26px] border-[2px] border-[#111] cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="font-mono text-[7px] uppercase opacity-50">Emoji Avatar</label>
                    <input
                      value={agent.avatarEmoji || ''}
                      onChange={e => updateAgent(agent.id, 'avatarEmoji', e.target.value)}
                      placeholder="e.g. 🤖"
                      className="w-full font-mono text-[10px] bg-[#f5f5f0] border-[2px] border-[#ddd] px-2 py-1 focus:outline-none focus:border-[#111]"
                    />
                  </div>
                  <div>
                    <label className="font-mono text-[7px] uppercase opacity-50">Behavior</label>
                    <select
                      value={agent.behavior || 'focused'}
                      onChange={e => updateAgent(agent.id, 'behavior', e.target.value)}
                      className="w-full font-mono text-[9px] bg-[#f5f5f0] border-[2px] border-[#ddd] px-2 py-1 focus:outline-none focus:border-[#111]"
                    >
                      {BEHAVIOR_PRESETS.map(p => (
                        <option key={p.value} value={p.value}>{p.label.split(' — ')[0]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="font-mono text-[7px] uppercase opacity-50">System Prompt Snippet</label>
                  <textarea
                    value={agent.systemPrompt || ''}
                    onChange={e => updateAgent(agent.id, 'systemPrompt', e.target.value)}
                    placeholder="Instructions for this agent..."
                    rows={2}
                    className="w-full font-mono text-[9px] bg-[#f5f5f0] border-[2px] border-[#ddd] px-2 py-1 focus:outline-none focus:border-[#111] resize-none"
                  />
                </div>
                {BEHAVIOR_PRESETS.find(p => p.value === agent.behavior) && (
                  <p className="font-mono text-[7px] text-[#888] italic">
                    {BEHAVIOR_PRESETS.find(p => p.value === agent.behavior).label.split(' — ')[1]}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* CONFIG TAB */}
        {activeTab === 'config' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="font-mono text-[9px] font-black uppercase text-[#555]">CONFIG_MANAGEMENT</p>
              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-[3px] border-[#111] bg-white font-mono text-[10px] font-black uppercase hover:bg-[#111] hover:text-[#eae7de] transition-colors"
                >
                  <Upload size={14} /> EXPORT
                </button>
                <button
                  onClick={handleImport}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-[3px] border-[#111] bg-white font-mono text-[10px] font-black uppercase hover:bg-[#111] hover:text-[#eae7de] transition-colors"
                >
                  <Download size={14} /> IMPORT
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[9px] font-black uppercase text-[#555]">CLEAR_DATA</p>
              <button
                onClick={() => {
                  if (confirm('Clear all messages and reset config?')) {
                    localStorage.removeItem('80m-agent-messages');
                    localStorage.removeItem('80m-agent-config');
                    window.location.reload();
                  }
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 border-[3px] border-[#ef4444] bg-white text-[#ef4444] font-mono text-[10px] font-black uppercase hover:bg-[#ef4444] hover:text-white transition-colors"
              >
                <Trash2 size={14} /> RESET ALL
              </button>
            </div>
          </div>
        )}

        {/* TEMPLATES TAB */}
        {activeTab === 'templates' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[9px] font-black uppercase text-[#555]">Prompt_Templates</p>
              <button
                onClick={() => {
                  const name = prompt('Template name:');
                  if (name && name.trim()) {
                    const prompt_text = prompt('Prompt text:');
                    if (prompt_text !== null) {
                      setLocalConfig(prev => ({
                        ...prev,
                        templates: [...(prev.templates || []), { id: Date.now().toString(36), name: name.trim(), text: prompt_text }],
                      }));
                    }
                  }
                }}
                className="p-1 hover:text-[#22c55e]"
              >
                <Plus size={14} />
              </button>
            </div>
            {(localConfig.templates || []).length === 0 && (
              <div className="text-center py-6 border-[2px] border-dashed border-[#ddd]">
                <FileText size={20} className="mx-auto text-[#ddd] mb-2" />
                <p className="font-mono text-[8px] text-[#aaa] uppercase">No templates yet</p>
                <p className="font-mono text-[7px] text-[#ccc] mt-1">Save reusable prompts here</p>
              </div>
            )}
            {(localConfig.templates || []).map(tpl => (
              <div key={tpl.id} className="border-[3px] border-[#111] bg-white p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-sans font-black uppercase text-[10px]">{tpl.name}</p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        // Inject into chat input
                        const textarea = document.querySelector('textarea[placeholder*="Message"]');
                        if (textarea) {
                          textarea.value = tpl.text;
                          textarea.dispatchEvent(new Event('input', { bubbles: true }));
                          textarea.focus();
                        }
                      }}
                      className="p-1 hover:text-[#22c55e]"
                      title="Use template"
                    >
                      <ExternalLink size={10} />
                    </button>
                    <button
                      onClick={() => setLocalConfig(prev => ({ ...prev, templates: prev.templates.filter(t => t.id !== tpl.id) }))}
                      className="p-1 hover:text-[#ef4444]"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
                <p className="font-mono text-[8px] text-[#666] bg-[#f5f5f0] p-2 whitespace-pre-wrap leading-relaxed border border-[#ddd]">{tpl.text}</p>
              </div>
            ))}
          </div>
        )}

        {/* HOTKEYS TAB */}
        {activeTab === 'hotkeys' && (
          <div className="space-y-3">
            <p className="font-mono text-[9px] font-black uppercase text-[#555]">Keyboard_Shortcuts</p>
            <div className="space-y-1">
              {[
                { key: 'Ctrl + K', desc: 'Open command palette' },
                { key: 'Ctrl + Enter', desc: 'Send message' },
                { key: 'Escape', desc: 'Close panels / Cancel' },
                { key: 'Ctrl + N', desc: 'New conversation' },
                { key: 'Ctrl + Shift + P', desc: 'Toggle preview' },
              ].map(hk => (
                <div key={hk.key} className="flex items-center justify-between p-2 border-[2px] border-[#ddd] bg-white">
                  <span className="font-mono text-[8px] text-[#666]">{hk.desc}</span>
                  <kbd className="font-mono text-[8px] bg-[#111] text-[#eae7de] px-2 py-1 border-[2px] border-[#333]">{hk.key}</kbd>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ABOUT TAB */}
        {activeTab === 'about' && (
          <div className="space-y-4">
            <div className="p-4 border-[3px] border-[#111] bg-[#111] text-center">
              <h2 className="font-[family-name:['Bodoni+Moda',serif]] font-black text-4xl text-[#e8e8ec] tracking-widest">80M<span className="text-[#22c55e]">.</span></h2>
              <p className="font-mono text-[10px] text-[#22c55e] mt-1 uppercase tracking-widest">Agent Control v1.0</p>
              <p className="font-mono text-[9px] text-[#eae7de]/50 mt-2">Sovereign Agent Council — Mission Control Interface</p>
            </div>
            <div className="space-y-2">
              <p className="font-mono text-[9px] font-black uppercase text-[#555]">HOW IT WORKS</p>
              <div className="space-y-2">
                {[
                  ['1. Configure', 'Set your API endpoint in Connection tab. Leave empty for demo mode.'],
                  ['2. Select Agent', 'Pick your agent from the sidebar. Each has a specialized role.'],
                  ['3. Execute', 'Type your prompt and hit Execute. Watch the mascot animate.'],
                  ['4. Install PWA', 'Add to home screen for a native app experience. Works offline.'],
                ].map(([title, desc]) => (
                  <div key={title} className="p-3 border-[2px] border-[#111] bg-white">
                    <p className="font-mono text-[10px] font-black uppercase text-[#111]">{title}</p>
                    <p className="font-mono text-[9px] text-[#555] mt-1">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-3 border-[2px] border-[#111] bg-[#fef9c3]">
              <p className="font-mono text-[9px] font-black uppercase text-[#854d0e]">TIP</p>
              <p className="font-mono text-[9px] text-[#854d0e] mt-1">
                Export your config to share with clients. Import their config to clone a setup.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Save */}
      <div className="p-4 border-t-[4px] border-[#111] bg-[#eae7de]">
        <button
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 border-[4px] border-[#111] bg-[#22c55e] text-[#111] font-sans font-black uppercase text-sm hover:bg-[#111] hover:text-[#22c55e] shadow-[6px_6px_0_0_#111] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all"
        >
          <Save size={16} /> APPLY CONFIG
        </button>
      </div>
    </motion.div>
  );
};

// =====================================================================
// MEMORY BROWSER — searches Fabric memory via Hermes chat endpoint
// Replaces KnowledgeVaultPanel stub
// =====================================================================
const MemoryBrowserPanel = ({ onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('search'); // 'search' | 'recent'
  const [expandedId, setExpandedId] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HERMES_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Search my fabric memory for: ${query.trim()}`,
          agent_id: 'prawnius',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setResults([{
        id: Date.now().toString(36),
        title: `Results for "${query}"`,
        content: text,
        date: new Date().toLocaleString(),
        agent: 'fabric',
        score: null,
      }]);
    } catch (err) {
      setError(`Search failed: ${err.message}`);
    }
    setLoading(false);
  };

  const loadRecent = async () => {
    setLoading(true);
    setError('');
    setActiveTab('recent');
    try {
      const res = await fetch(`${HERMES_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Show me my 10 most recent Fabric memory entries with titles and dates',
          agent_id: 'prawnius',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setResults([{
        id: 'recent',
        title: 'Recent Memories',
        content: text,
        date: new Date().toLocaleString(),
        agent: 'fabric',
        score: null,
      }]);
    } catch (err) {
      setError(`Could not load recent memories: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="border-[3px] border-[#111] bg-white shadow-[6px_6px_0_0_#111] p-4 max-w-md mx-auto max-h-[80vh] flex flex-col"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-[#111]" />
          <span className="font-mono text-[10px] font-black uppercase">Memory_Browser</span>
        </div>
        <button onClick={onClose} className="p-1 hover:text-[#ef4444] transition-colors"><X size={14} /></button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setActiveTab('search')}
          className={`px-3 py-1.5 font-mono text-[8px] font-black uppercase border-[2px] border-[#111] transition-colors ${activeTab === 'search' ? 'bg-[#111] text-[#22c55e]' : 'bg-white text-[#111] hover:bg-[#f5f5f0]'}`}
        >SEARCH</button>
        <button
          onClick={() => { setActiveTab('recent'); if (results.length === 0 || activeTab !== 'recent') loadRecent(); }}
          className={`px-3 py-1.5 font-mono text-[8px] font-black uppercase border-[2px] border-[#111] transition-colors ${activeTab === 'recent' ? 'bg-[#111] text-[#22c55e]' : 'bg-white text-[#111] hover:bg-[#f5f5f0]'}`}
        >RECENT</button>
      </div>

      {/* Search form */}
      {activeTab === 'search' && (
        <form onSubmit={handleSearch} className="flex gap-2 mb-3">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search memory..."
            className="flex-1 bg-[#f5f5f0] border-[2px] border-[#111] px-3 py-2 font-mono text-xs focus:outline-none focus:border-[#22c55e]"
          />
          <button type="submit" className="px-4 py-2 bg-[#111] text-[#22c55e] font-mono text-[10px] font-black uppercase border-[2px] border-[#111] hover:bg-[#222]">
            {loading ? '...' : 'GO'}
          </button>
        </form>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
        {loading && (
          <div className="flex justify-center py-6">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce"></div>
            </div>
          </div>
        )}
        {error && (
          <div className="p-2 border-[2px] border-[#ef4444] bg-[#fef2f2]">
            <p className="font-mono text-[9px] text-[#ef4444]">{error}</p>
          </div>
        )}
        {results.length === 0 && !loading && !error && (
          <p className="font-mono text-[9px] text-[#999] text-center py-4">
            {activeTab === 'search' ? 'Search your Fabric memory.' : 'Click Recent to load memories.'}
          </p>
        )}
        {results.map(r => (
          <div key={r.id} className="border-[2px] border-[#ddd] hover:border-[#111] transition-all">
            <div
              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              className="flex items-start gap-2 p-2 cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[10px] font-black uppercase truncate">{r.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-[7px] text-[#888]">{r.date}</span>
                  {r.agent && <span className="font-mono text-[7px] text-[#22c55e]">@{r.agent}</span>}
                </div>
              </div>
              <span className="font-mono text-[7px] text-[#aaa] flex-shrink-0">{expandedId === r.id ? '▲' : '▼'}</span>
            </div>
            {expandedId === r.id && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="border-t-[2px] border-[#ddd] p-2 bg-[#fafaf5] max-h-60 overflow-y-auto"
              >
                <p className="font-mono text-[9px] text-[#555] leading-relaxed whitespace-pre-wrap">{r.content}</p>
              </motion.div>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
};

// =====================================================================
// JOBS PIPELINE — shows active/orchestrated tasks
// =====================================================================
const JobsPipelinePanel = ({ onClose }) => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [polling, setPolling] = useState(false);

  const fetchJobs = async () => {
    setLoading(true);
    setError('');
    try {
      // Try Hermes jobs endpoint
      let res = await fetch(`${HERMES_BASE}/jobs`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        // Fallback: try /fs/list for a jobs directory
        res = await fetch(`${HERMES_BASE}/fs/list?path=/home/falcon/.hermes/jobs`, { signal: AbortSignal.timeout(5000) });
      }
      if (res.ok) {
        let data = await res.json();
        // If it's a fs/list response, build job cards from files
        if (data.files) {
          data = (data.files || []).map(f => ({
            id: f.name,
            agent: 'unknown',
            status: f.type === 'dir' ? 'running' : 'completed',
            timestamp: f.mtime || Date.now(),
          }));
        }
        setJobs(Array.isArray(data) ? data : []);
      } else {
        setJobs([]);
      }
    } catch (err) {
      setError(`Could not reach jobs endpoint: ${err.message}`);
      setJobs([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchJobs(); }, []);

  // Auto-poll every 10s
  useEffect(() => {
    const interval = setInterval(() => {
      setPolling(true);
      fetchJobs().then(() => setPolling(false));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const statusColor = (status) => {
    if (status === 'completed' || status === 'done') return 'text-[#22c55e]';
    if (status === 'failed') return 'text-[#ef4444]';
    if (status === 'running' || status === 'pending') return 'text-[#f59e0b]';
    return 'text-[#888]';
  };

  const statusDot = (status) => {
    if (status === 'completed' || status === 'done') return 'bg-[#22c55e]';
    if (status === 'failed') return 'bg-[#ef4444]';
    if (status === 'running' || status === 'pending') return 'bg-[#f59e0b] animate-pulse';
    return 'bg-[#aaa]';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="border-[3px] border-[#111] bg-white shadow-[6px_6px_0_0_#111] p-4 max-w-md mx-auto max-h-[80vh] flex flex-col"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-[#111]" />
          <span className="font-mono text-[10px] font-black uppercase">Jobs_Pipeline</span>
          <span className="font-mono text-[8px] text-[#888]">({jobs.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={fetchJobs} className="p-1 hover:text-[#22c55e] transition-colors" title="Refresh">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={onClose} className="p-1 hover:text-[#ef4444] transition-colors"><X size={14} /></button>
        </div>
      </div>

      {polling && <p className="font-mono text-[7px] text-[#aaa] text-center mb-2">Auto-refreshing every 10s...</p>}

      <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
        {loading && jobs.length === 0 && (
          <div className="flex justify-center py-6">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce"></div>
            </div>
          </div>
        )}
        {error && (
          <div className="p-2 border-[2px] border-[#ef4444] bg-[#fef2f2]">
            <p className="font-mono text-[9px] text-[#ef4444]">{error}</p>
            <p className="font-mono text-[8px] text-[#aaa] mt-1">Jobs are tracked by Hermes when agents delegate tasks.</p>
          </div>
        )}
        {!loading && jobs.length === 0 && !error && (
          <div className="text-center py-8">
            <Cpu size={32} className="mx-auto text-[#ddd] mb-2" />
            <p className="font-mono text-[10px] font-black uppercase text-[#aaa]">No Active Jobs</p>
            <p className="font-mono text-[8px] text-[#ccc] mt-1">When agents delegate tasks, they appear here.</p>
          </div>
        )}
        {jobs.map(job => (
          <div key={job.id} className="p-3 border-[2px] border-[#ddd] hover:border-[#111] transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[10px] font-black uppercase truncate">{job.id}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-[7px] text-[#888]">{job.agent || 'agent'}</span>
                  {job.timestamp && (
                    <span className="font-mono text-[7px] text-[#aaa]">{formatRelativeTime(job.timestamp)}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${statusDot(job.status)}`} />
                  <span className={`font-mono text-[8px] font-black uppercase ${statusColor(job.status)}`}>{job.status}</span>
                </div>
                {job.tools_count !== undefined && (
                  <span className="font-mono text-[7px] text-[#888]">{job.tools_count} tools</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

// =====================================================================
// MCP SETTINGS — reads ~/.hermes/config.yaml and displays MCP servers
// =====================================================================
const MCPSettingsPanel = ({ onClose }) => {
  const [configText, setConfigText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [servers, setServers] = useState([]);
  const [testResults, setTestResults] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', command: '', env: '' });

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/fs/read?path=/home/falcon/.hermes/config.yaml', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setConfigText(text);
      // Simple YAML parse — extract mcp servers section
      const mcpMatch = text.match(/mcp:\s*\n([\s\S]*?)(?=\n\w|\n*$)/);
      const serverBlocks = [];
      if (mcpMatch) {
        const lines = mcpMatch[1].split('\n');
        let current = null;
        for (const line of lines) {
          const indent = line.match(/^(\s*)/)[1].length;
          if (indent === 2 && line.includes(':')) {
            if (current) serverBlocks.push(current);
            current = { name: line.trim().replace(':', ''), command: '', env: '' };
          } else if (current && indent === 4) {
            if (line.includes('command:')) current.command = line.split('command:')[1].trim();
            if (line.includes('env:')) current.env = line.split('env:')[1].trim();
          }
        }
        if (current) serverBlocks.push(current);
      }
      setServers(serverBlocks);
    } catch (err) {
      setError(`Could not load MCP config: ${err.message}`);
      setServers([]);
    }
    setLoading(false);
  };

  const testConnection = async (serverName) => {
    setTestResults(prev => ({ ...prev, [serverName]: 'testing' }));
    try {
      const res = await fetch(`${HERMES_BASE}/mcp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: serverName }),
        signal: AbortSignal.timeout(8000),
      });
      const ok = res.ok;
      setTestResults(prev => ({ ...prev, [serverName]: ok ? 'ok' : 'fail' }));
    } catch {
      setTestResults(prev => ({ ...prev, [serverName]: 'fail' }));
    }
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed inset-y-0 right-0 w-full max-w-md bg-[#eae7de] border-l-[4px] border-[#111] z-[200] flex flex-col shadow-[-10px_0_40px_rgba(0,0,0,0.3)]"
    >
      <div className="flex items-center justify-between p-4 border-b-[4px] border-[#111] bg-[#111]">
        <div className="flex items-center gap-3">
          <Plug size={18} className="text-[#22c55e]" />
          <span className="font-serif font-black text-xl text-[#eae7de] tracking-tight">MCP_CONFIG</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadConfig} className="p-2 text-[#e8e8ec]/50 hover:text-[#22c55e] transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={onClose} className="p-2 text-[#e8e8ec] hover:text-[#ef4444] transition-colors"><X size={18} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {/* MCP Servers list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[9px] font-black uppercase text-[#555]">MCP_SERVERS ({servers.length})</p>
            <button
              onClick={() => setShowAddForm(v => !v)}
              className="flex items-center gap-1 px-3 py-1.5 border-[2px] border-[#111] bg-[#22c55e] text-[#111] font-mono text-[9px] font-black uppercase hover:bg-[#111] hover:text-[#22c55e] transition-colors"
            ><Plus size={12} /> ADD</button>
          </div>

          {loading && (
            <div className="flex justify-center py-4">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce"></div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 border-[3px] border-[#ef4444] bg-[#fef2f2]">
              <p className="font-mono text-[10px] text-[#ef4444] font-black uppercase">{error}</p>
              <p className="font-mono text-[8px] text-[#aaa] mt-1">Place your MCP servers in ~/.hermes/config.yaml under an mcp: key.</p>
            </div>
          )}

          {/* Add server form */}
          {showAddForm && (
            <div className="p-3 border-[3px] border-[#22c55e] bg-white mb-3 space-y-2">
              <p className="font-mono text-[9px] font-black uppercase">NEW_SERVER</p>
              <input
                type="text"
                value={newServer.name}
                onChange={e => setNewServer(p => ({ ...p, name: e.target.value }))}
                placeholder="Server name"
                className="w-full bg-[#f5f5f0] border-[2px] border-[#111] px-3 py-2 font-mono text-[10px] focus:outline-none focus:border-[#22c55e]"
              />
              <input
                type="text"
                value={newServer.command}
                onChange={e => setNewServer(p => ({ ...p, command: e.target.value }))}
                placeholder="Command (e.g. npx -y @modelcontextprotocol/server-filesystem)"
                className="w-full bg-[#f5f5f0] border-[2px] border-[#111] px-3 py-2 font-mono text-[10px] focus:outline-none focus:border-[#22c55e]"
              />
              <input
                type="text"
                value={newServer.env}
                onChange={e => setNewServer(p => ({ ...p, env: e.target.value }))}
                placeholder="Env vars (optional)"
                className="w-full bg-[#f5f5f0] border-[2px] border-[#111] px-3 py-2 font-mono text-[10px] focus:outline-none focus:border-[#22c55e]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (newServer.name && newServer.command) {
                      setServers(prev => [...prev, newServer]);
                      setNewServer({ name: '', command: '', env: '' });
                      setShowAddForm(false);
                    }
                  }}
                  className="flex-1 px-4 py-2 bg-[#22c55e] text-[#111] border-[2px] border-[#111] font-mono text-[10px] font-black uppercase hover:bg-[#111] hover:text-[#22c55e]"
                >SAVE</button>
                <button onClick={() => setShowAddForm(false)} className="flex-1 px-4 py-2 bg-white text-[#ef4444] border-[2px] border-[#ef4444] font-mono text-[10px] font-black uppercase hover:bg-[#ef4444] hover:text-white">CANCEL</button>
              </div>
            </div>
          )}

          {servers.length === 0 && !loading && !error && (
            <div className="text-center py-6 border-[2px] border-dashed border-[#ddd]">
              <Plug size={24} className="mx-auto text-[#ddd] mb-2" />
              <p className="font-mono text-[10px] text-[#aaa] uppercase">No MCP Servers Configured</p>
              <p className="font-mono text-[8px] text-[#ccc] mt-1">Add servers in ~/.hermes/config.yaml</p>
            </div>
          )}

          {servers.map(server => (
            <div key={server.name} className="p-3 border-[3px] border-[#111] bg-white space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plug size={14} className="text-[#111]" />
                  <p className="font-sans font-black uppercase text-[11px]">{server.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  {testResults[server.name] === 'ok' && <span className="font-mono text-[8px] text-[#22c55e] font-black uppercase">CONNECTED</span>}
                  {testResults[server.name] === 'fail' && <span className="font-mono text-[8px] text-[#ef4444] font-black uppercase">FAIL</span>}
                  <button
                    onClick={() => testConnection(server.name)}
                    className="px-2 py-1 bg-[#111] text-[#22c55e] border-[2px] border-[#111] font-mono text-[8px] font-black uppercase hover:bg-[#222] transition-colors"
                    disabled={testResults[server.name] === 'testing'}
                  >
                    {testResults[server.name] === 'testing' ? '...' : 'TEST'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1">
                <div className="flex items-start gap-2">
                  <span className="font-mono text-[7px] text-[#888] uppercase w-12 flex-shrink-0">CMD</span>
                  <span className="font-mono text-[8px] text-[#555] break-all">{server.command}</span>
                </div>
                {server.env && (
                  <div className="flex items-start gap-2">
                    <span className="font-mono text-[7px] text-[#888] uppercase w-12 flex-shrink-0">ENV</span>
                    <span className="font-mono text-[8px] text-[#555] break-all">{server.env}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Raw config */}
        {configText && (
          <div>
            <p className="font-mono text-[9px] font-black uppercase text-[#555] mb-2">RAW_CONFIG</p>
            <pre className="font-mono text-[8px] text-[#666] whitespace-pre-wrap bg-white border-[3px] border-[#111] p-3 max-h-60 overflow-y-auto">{configText}</pre>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// =====================================================================
// PWA INSTALL BANNER (additive)
// =====================================================================
const PWAInstallBanner = ({ onInstall, onDismiss }) => (
  <motion.div
    initial={{ y: 80, opacity: 0 }}
    animate={{ y: 0, opacity: 1 }}
    className="fixed bottom-0 left-0 right-0 z-[300] p-4 bg-[#111] border-t-[4px] border-[#22c55e] flex items-center justify-between gap-4 shadow-[0_-10px_40px_rgba(34,197,94,0.2)]"
  >
    <div className="flex items-center gap-3">
      <span className="font-[family-name:['Bodoni+Moda',serif]] font-black text-xl text-[#e8e8ec] tracking-widest">80M<span className="text-[#22c55e]">.</span></span>
      <span className="font-mono text-[10px] text-[#eae7de]/70 uppercase tracking-wide">Install as App</span>
    </div>
    <div className="flex items-center gap-2">
      <button
        onClick={onInstall}
        className="px-6 py-2 bg-[#22c55e] text-[#111] font-mono text-[10px] font-black uppercase border-[2px] border-[#22c55e] hover:bg-[#111] hover:text-[#22c55e] transition-colors"
      >
        Install
      </button>
      <button
        onClick={onDismiss}
        className="p-2 text-[#eae7de]/50 hover:text-[#eae7de] transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  </motion.div>
);

// =====================================================================
// KNOWLEDGE VAULT PANEL (additive — was a placeholder click target)
// =====================================================================
const KnowledgeVaultPanel = ({ onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    // Simulated search — in production would call a search API
    setTimeout(() => {
      setResults([{ id: 1, title: `Result for "${query}"`, snippet: 'Search result snippets would appear here...', date: 'Just now' }]);
      setLoading(false);
    }, 1200);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="border-[3px] border-[#111] bg-white shadow-[6px_6px_0_0_#111] p-4 max-w-md mx-auto"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-[#111]" />
          <span className="font-mono text-[10px] font-black uppercase">Knowledge_Vault</span>
        </div>
        <button onClick={onClose} className="p-1 hover:text-[#22c55e] transition-colors"><X size={14} /></button>
      </div>
      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search knowledge base..."
          className="flex-1 bg-[#f5f5f0] border-[2px] border-[#111] px-3 py-2 font-mono text-xs focus:outline-none"
        />
        <button type="submit" className="px-4 py-2 bg-[#111] text-[#22c55e] font-mono text-[10px] font-black uppercase border-[2px] border-[#111] hover:bg-[#222]">
          {loading ? '...' : 'GO'}
        </button>
      </form>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {results.length === 0 && !loading && (
          <p className="font-mono text-[9px] text-[#999] text-center py-4">No queries yet. Start searching.</p>
        )}
        {results.map(r => (
          <div key={r.id} className="p-2 border-[2px] border-[#ddd] hover:border-[#111] transition-colors cursor-pointer">
            <p className="font-mono text-[10px] font-black uppercase">{r.title}</p>
            <p className="font-mono text-[9px] text-[#666] mt-1">{r.snippet}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

// =====================================================================
// SKILLS HUB — reads skill files from Hermes ~/.hermes/skills directory
// Replaces SkillsModulePanel stub
// =====================================================================
const SkillsHubPanel = ({ onClose }) => {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HERMES_BASE}/fs/list?path=/home/falcon/.hermes/skills`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const dirs = (data.files || []).filter(f => f.type === 'dir');

      const skillData = await Promise.all(
        dirs.map(async (dir) => {
          try {
            const mdRes = await fetch(`/fs/read?path=/home/falcon/.hermes/skills/${dir.name}/SKILL.md`);
            if (!mdRes.ok) return { id: dir.name, name: dir.name.replace(/-/g, '_').toUpperCase(), description: 'No description', category: 'general', status: 'ready', raw: '' };
            const mdText = await mdRes.text();
            const nameMatch = mdText.match(/^name:\s*(.+)$/m);
            const descMatch = mdText.match(/^description:\s*(.+)$/m);
            const catMatch = mdText.match(/^category:\s*(.+)$/m);
            return {
              id: dir.name,
              name: nameMatch ? nameMatch[1].trim() : dir.name.replace(/-/g, '_').toUpperCase(),
              description: descMatch ? descMatch[1].trim() : 'No description',
              category: catMatch ? catMatch[1].trim().toLowerCase() : 'general',
              status: 'ready',
              raw: mdText,
            };
          } catch {
            return { id: dir.name, name: dir.name.replace(/-/g, '_').toUpperCase(), description: 'Error loading', category: 'general', status: 'error', raw: '' };
          }
        })
      );
      setSkills(skillData);
    } catch (err) {
      setError(`Failed to load skills: ${err.message}`);
      setSkills([]);
    }
    setLoading(false);
  };

  const categories = ['all', ...new Set(skills.map(s => s.category))];
  const filtered = skills.filter(s => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === 'all' || s.category === categoryFilter;
    return matchSearch && matchCat;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="border-[3px] border-[#111] bg-white shadow-[6px_6px_0_0_#111] p-4 max-w-md mx-auto max-h-[80vh] flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-[#111]" />
          <span className="font-mono text-[10px] font-black uppercase">Skills_Hub</span>
          <span className="font-mono text-[8px] text-[#888]">({skills.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={loadSkills} className="p-1 hover:text-[#22c55e] transition-colors" title="Refresh">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={onClose} className="p-1 hover:text-[#ef4444] transition-colors"><X size={14} /></button>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search skills..."
        className="w-full bg-[#f5f5f0] border-[2px] border-[#111] px-3 py-2 font-mono text-[10px] mb-2 focus:outline-none focus:border-[#22c55e]"
      />

      {/* Category filter */}
      <div className="flex gap-1 flex-wrap mb-3">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-2 py-1 font-mono text-[7px] font-black uppercase border-[2px] border-[#111] transition-colors ${categoryFilter === cat ? 'bg-[#111] text-[#22c55e]' : 'bg-white text-[#111] hover:bg-[#f5f5f0]'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Skills grid */}
      <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
        {loading && skills.length === 0 && (
          <div className="flex justify-center py-6">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce"></div>
            </div>
          </div>
        )}
        {error && (
          <div className="p-2 border-[2px] border-[#ef4444] bg-[#fef2f2]">
            <p className="font-mono text-[9px] text-[#ef4444]">{error}</p>
          </div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <p className="font-mono text-[9px] text-[#999] text-center py-4">No skills match your search.</p>
        )}
        {filtered.map(skill => (
          <div key={skill.id} className="border-[2px] border-[#ddd] hover:border-[#111] transition-all">
            <div
              onClick={() => setExpandedId(expandedId === skill.id ? null : skill.id)}
              className="flex items-start gap-2 p-2 cursor-pointer"
            >
              <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${skill.status === 'ready' ? 'bg-[#22c55e] shadow-[0_0_6px_#22c55e]' : 'bg-[#ef4444]'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[10px] font-black uppercase truncate">{skill.name}</p>
                  {skill.category !== 'general' && (
                    <span className="font-mono text-[7px] bg-[#f5f5f0] px-1.5 py-0.5 border border-[#ddd] text-[#888] flex-shrink-0">{skill.category}</span>
                  )}
                </div>
                <p className="font-mono text-[8px] text-[#666] mt-0.5 truncate">{skill.description}</p>
              </div>
              <span className="font-mono text-[7px] text-[#aaa] flex-shrink-0">{expandedId === skill.id ? '▲' : '▼'}</span>
            </div>
            {expandedId === skill.id && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="border-t-[2px] border-[#ddd] p-2 bg-[#fafaf5]"
              >
                <p className="font-mono text-[8px] text-[#555] leading-relaxed whitespace-pre-wrap">{skill.description}</p>
                {skill.raw && (
                  <details className="mt-2">
                    <summary className="font-mono text-[7px] text-[#888] cursor-pointer hover:text-[#111]">SHOW SKILL FILE</summary>
                    <pre className="mt-1 font-mono text-[8px] text-[#666] whitespace-pre-wrap bg-[#f5f5f0] p-2 border border-[#ddd] max-h-40 overflow-y-auto">{skill.raw}</pre>
                  </details>
                )}
              </motion.div>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
};

// =====================================================================
// ORIGINAL UI — Global Components (unchanged)
// =====================================================================
// =====================================================================
// FILM GRAIN CANVAS — full-screen canvas above all UI, z-index 9999
// =====================================================================
const FilmGrainCanvas = () => {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let rafId;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      frameRef.current++;
      // Regenerate grain every 2-3 frames for analog flicker
      if (frameRef.current % 3 === 0) {
        const w = canvas.width;
        const h = canvas.height;
        const imageData = ctx.createImageData(w, h);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const v = Math.random() * 255;
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
          data[i + 3] = (0.04 * 255); // 4% opacity
        }
        ctx.putImageData(imageData, 0, 0);
      }
      rafId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-[9999] pointer-events-none"
      aria-hidden="true"
    />
  );
};

// Alias for backwards compatibility
const NoiseOverlay = FilmGrainCanvas;

const PaperBackground = () => (
  <div aria-hidden="true">
    <div className="fixed inset-0 z-[-4] bg-[#eae7de]"></div>
    <div className="fixed inset-0 z-[-3] opacity-60 mix-blend-multiply overflow-hidden pointer-events-none">
      <div className="absolute top-[-10%] left-[-5%] w-[60vw] h-[60vw] bg-[#38bdf8] rounded-full blur-[140px] opacity-25"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[70vw] h-[70vw] bg-[#0ea5e9] rounded-full blur-[160px] opacity-20"></div>
    </div>
    <div className="fixed inset-0 z-[-2] bg-[url('https://www.transparenttextures.com/patterns/cream-paper.png')] opacity-40 mix-blend-multiply pointer-events-none"></div>
  </div>
);

// =====================================================================
// ANIMATED 80M LOGO CANVAS — canvas-rendered sidebar logo
// =====================================================================
const AnimatedLogoCanvas = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let rafId;
    let startTime = Date.now();

    const resize = () => {
      // 2x for retina
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();

    const draw = () => {
      const elapsed = Date.now() - startTime;
      // ~3s breathing period
      const breathe = 0.5 + 0.5 * Math.sin((elapsed / 3000) * Math.PI * 2);
      const glowRadius = 4 + breathe * 12;
      const glowAlpha = 0.3 + breathe * 0.5;

      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;

      ctx.clearRect(0, 0, w, h);

      // Shadow/glow layer
      ctx.save();
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = glowRadius;
      ctx.font = `bold ${h * 0.85}px 'Bodoni Moda', 'Georgia', serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      // Draw "80M" in off-white
      ctx.fillStyle = '#e8e8ec';
      ctx.fillText('80M', 0, 0);

      // Draw "." dot slightly brighter green
      ctx.shadowBlur = glowRadius + 4;
      ctx.fillStyle = `rgba(34, ${197 + Math.floor(breathe * 30)}, 94, ${0.8 + breathe * 0.2})`;
      const dotX = ctx.measureText('80M').width + 2;
      ctx.fillText('.', dotX, 0);

      ctx.restore();

      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 120, height: 44, display: 'block' }}
      aria-hidden="true"
    />
  );
};

// =====================================================================
// PARTICLE FIELD CANVAS — background layer, z-index 0
// =====================================================================
const ParticleFieldCanvas = () => {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let rafId;
    const PARTICLE_COUNT = 80;
    const MAX_DIST = 120;
    const MOUSE_REPEL_RADIUS = 150;
    const MOUSE_REPEL_STRENGTH = 0.8;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const onMouseMove = (e) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMouseMove);

    // Init particles once
    if (particlesRef.current.length !== PARTICLE_COUNT) {
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: Math.random() * 2 + 1,
      }));
    }

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      // Update & respawn particles
      for (const p of particles) {
        // Brownian drift
        p.vx += (Math.random() - 0.5) * 0.1;
        p.vy += (Math.random() - 0.5) * 0.1;
        // Damping
        p.vx *= 0.98;
        p.vy *= 0.98;

        // Mouse repulsion
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_REPEL_RADIUS && dist > 0) {
          const force = (MOUSE_REPEL_RADIUS - dist) / MOUSE_REPEL_RADIUS * MOUSE_REPEL_STRENGTH;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }

        p.x += p.vx;
        p.y += p.vy;

        // Respawn off-screen
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;
      }

      // Draw connecting lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < MAX_DIST) {
            // Mouse proximity highlights line
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const mDist = Math.sqrt((mx - mouse.x) ** 2 + (my - mouse.y) ** 2);
            const highlight = mDist < MOUSE_REPEL_RADIUS ? 1 : 0;
            const baseAlpha = (1 - d / MAX_DIST) * 0.35;
            const alpha = baseAlpha + highlight * 0.3;
            const green = highlight ? '#4ade80' : '#22c55e';
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = green;
            ctx.globalAlpha = Math.min(alpha, 1);
            ctx.lineWidth = highlight ? 1.5 : 0.8;
            ctx.stroke();
          }
        }
      }

      // Draw particles
      ctx.globalAlpha = 1;
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      aria-hidden="true"
    />
  );
};

// --- Split-View Preview Panel ---
const PreviewPanel = ({ content, filePath, onClose }) => {
  const [fileContent, setFileContent] = useState(content);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState('');
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('80m-preview-last-mode') || 'auto');
  const [modePrefs, setModePrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('80m-preview-mode-prefs') || '{}'); } catch { return {}; }
  });
  const [pdfBlobUrl, setPdfBlobUrl] = useState('');

  // Detect language from file extension
  const detectLang = (path) => {
    const ext = (path || '').split('.').pop().toLowerCase();
    const map = { js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python', rs: 'rust', go: 'go', css: 'css', html: 'html', json: 'json', md: 'markdown', sh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'toml' };
    return map[ext] || ext || 'text';
  };

  const detectDocType = (path = '', text = '') => {
    const ext = (path.split('.').pop() || '').toLowerCase();
    const codeExts = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'css', 'scss', 'html', 'json', 'sh', 'yml', 'yaml', 'toml', 'java', 'kt', 'c', 'cpp', 'h', 'hpp', 'rb', 'php', 'swift']);
    const docExts = new Set(['md', 'txt', 'rst', 'adoc']);
    const unsupportedDocExts = new Set(['doc', 'docx', 'rtf', 'odt']);
    if (ext === 'pdf' || /^%PDF/m.test(text)) return 'pdf';
    if (codeExts.has(ext)) return 'code';
    if (docExts.has(ext)) return 'doc';
    if (unsupportedDocExts.has(ext)) return 'unsupported-doc';
    if (text.startsWith('```') || /^(import|export|const|function|class|def|fn|pub|package)\s/m.test(text)) return 'code';
    if (text.includes('# ') || text.includes('## ') || text.includes('**') || text.includes('- [ ]')) return 'doc';
    return 'doc';
  };

  // Fetch file content when filePath changes
  useEffect(() => {
    if (!filePath) { setFileContent(content); return; }
    setLoading(true); setError('');
    setLang(detectLang(filePath));

    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      // Fetch remote URL
      fetch(filePath)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(t => { setFileContent(t); setLoading(false); })
        .catch(e => { setError(`Failed to fetch: ${e.message}`); setLoading(false); });
    } else {
      // Read local file via API
      fetch(`/fs/read?path=${encodeURIComponent(filePath)}`)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(t => { setFileContent(t); setLoading(false); })
        .catch(() => {
          // Fallback: try the local file server
          fetch(`${LOCAL_API_BASE}/fs/read?path=${encodeURIComponent(filePath)}`)
            .then(r2 => { if (!r2.ok) throw new Error(`HTTP ${r2.status}`); return r2.text(); })
            .then(t2 => { setFileContent(t2); setLoading(false); })
            .catch(e2 => { setError(`Could not read file. Path: ${filePath}`); setLoading(false); });
        });
    }
  }, [filePath]);

  useEffect(() => {
    localStorage.setItem('80m-preview-last-mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!filePath) return;
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    if (modePrefs[ext]) setViewMode(modePrefs[ext]);
  }, [filePath, modePrefs]);

  useEffect(() => {
    let objectUrl = '';
    const type = detectDocType(filePath || '', fileContent || content || '');
    if (type !== 'pdf' || !filePath || filePath.startsWith('http://') || filePath.startsWith('https://')) {
      setPdfBlobUrl('');
      return;
    }

    const loadPdf = async () => {
      try {
        const candidates = [
          `/fs/raw?path=${encodeURIComponent(filePath)}`,
          `${LOCAL_API_BASE}/fs/raw?path=${encodeURIComponent(filePath)}`,
          `/fs/read?path=${encodeURIComponent(filePath)}`,
          `${LOCAL_API_BASE}/fs/read?path=${encodeURIComponent(filePath)}`,
        ];
        for (const url of candidates) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const blob = await res.blob();
            if (blob.size === 0) continue;
            objectUrl = URL.createObjectURL(blob);
            setPdfBlobUrl(objectUrl);
            return;
          } catch {}
        }
      } catch {}
    };
    loadPdf();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePath, fileContent, content]);

  const displayContent = fileContent || content || '';
  const autoType = detectDocType(filePath, displayContent);
  const preferredMode = filePath ? modePrefs[(filePath.split('.').pop() || '').toLowerCase()] : '';
  const effectiveView = viewMode === 'auto' ? (preferredMode || autoType) : viewMode;
  const effectiveLang = lang || detectLang(filePath);
  const previewSource = pdfBlobUrl || (filePath
    ? (filePath.startsWith('http://') || filePath.startsWith('https://')
      ? filePath
      : `${LOCAL_API_BASE}/fs/read?path=${encodeURIComponent(filePath)}`)
    : '');

  return (
    <div className="flex-1 flex flex-col border-l-[4px] border-[#111] bg-[#fafaf5] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b-[3px] border-[#111] bg-[#eae7de]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[9px] font-black uppercase tracking-widest text-[#111]">PREVIEW</span>
          {filePath && (
            <>
              <span className="text-[#aaa]">/</span>
              <span className="font-mono text-[8px] text-[#666] truncate max-w-[200px]" title={filePath}>{filePath}</span>
              {lang && <span className="font-mono text-[7px] bg-[#111] text-[#eae7de] px-1.5 py-0.5 font-black uppercase flex-shrink-0">{lang}</span>}
            </>
          )}
        </div>
        <button onClick={onClose} className="p-1 hover:text-[#ef4444] transition-colors flex-shrink-0"><X size={12} /></button>
      </div>
      <div className="px-4 py-2 border-b-[2px] border-[#111] bg-[#f5f4ed] flex items-center gap-2">
        {['auto', 'code', 'doc', 'pdf', 'raw'].map(mode => (
          <button
            key={mode}
            onClick={() => {
              setViewMode(mode);
              if (!filePath) return;
              const ext = (filePath.split('.').pop() || '').toLowerCase();
              const nextPrefs = { ...modePrefs };
              if (mode === 'auto') delete nextPrefs[ext];
              else nextPrefs[ext] = mode;
              setModePrefs(nextPrefs);
              localStorage.setItem('80m-preview-mode-prefs', JSON.stringify(nextPrefs));
            }}
            className={`px-2 py-1 border-[2px] font-mono text-[8px] font-black uppercase transition-colors ${viewMode === mode ? 'bg-[#111] text-[#22c55e] border-[#111]' : 'bg-white text-[#111] border-[#111] hover:text-[#22c55e]'}`}
          >
            {mode}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-4 custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce"></div>
            </div>
          </div>
        ) : error ? (
          <div className="p-4 border-[3px] border-[#ef4444] bg-[#fef2f2]">
            <p className="font-mono text-[10px] text-[#ef4444] font-black uppercase">{error}</p>
            <p className="font-mono text-[8px] text-[#aaa] mt-1">File path: {filePath}</p>
          </div>
        ) : effectiveView === 'pdf' ? (
          previewSource ? (
            <iframe
              title="PDF Preview"
              src={previewSource}
              className="w-full h-full min-h-[60vh] border-[3px] border-[#111] bg-white"
            />
          ) : (
            <div className="p-4 border-[3px] border-[#111] bg-white font-mono text-[9px]">
              Select a .pdf file path or URL to preview.
            </div>
          )
        ) : effectiveView === 'code' ? (
          <pre className={`font-mono text-[11px] whitespace-pre-wrap break-all bg-[#1a1a2e] text-[#a8dadc] p-4 border-[3px] border-[#111] shadow-[4px_4px_0_0_#111] overflow-auto lang-${effectiveLang}`}>
            <code>{displayContent}</code>
          </pre>
        ) : effectiveView === 'raw' ? (
          <pre className="font-mono text-[10px] whitespace-pre-wrap break-all bg-white p-4 border-[3px] border-[#111] shadow-[4px_4px_0_0_#111] overflow-auto text-[#111]">
            {displayContent || 'No content to preview.'}
          </pre>
        ) : autoType === 'unsupported-doc' ? (
          <div className="p-4 border-[3px] border-[#f59e0b] bg-[#fffbeb]">
            <p className="font-mono text-[10px] text-[#92400e] font-black uppercase">
              Rich document format detected ({(filePath || '').split('.').pop()?.toLowerCase()}).
            </p>
            <p className="font-mono text-[9px] text-[#92400e] mt-2">
              For best preview results, export this file to .txt or .md, then open it again.
            </p>
          </div>
        ) : (
          <div className="prose-custom font-serif text-[#111] leading-relaxed border-[2px] border-transparent">
            {displayContent?.includes('# ') || displayContent?.includes('```') || displayContent?.includes('- ') ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent || '_No content to preview_'}
              </ReactMarkdown>
            ) : (
              <div className="font-mono text-[11px] whitespace-pre-wrap break-words">
                {displayContent || 'No content to preview.'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- File Tree Browser ---
const FileTree = ({ rootPath, onFileSelect, selectedFile, onRefresh }) => {
  const [nodes, setNodes] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);

  const fetchDir = async (path) => {
    setLoading(true);
    try {
      // Try port 5174 first
      let res = await fetch(`${HERMES_BASE}/fs/list?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        res = await fetch(`${LOCAL_API_BASE}/fs/list?path=${encodeURIComponent(path)}`);
      }
      if (res.ok) {
        const data = await res.json();
        return data.files || [];
      }
    } catch {}
    return [];
  };

  const loadTree = useCallback(async (path = rootPath, parentExpanded = true) => {
    if (!path) return;
    const entries = await fetchDir(path);
    const treeNodes = entries.map(entry => ({
      ...entry,
      key: entry.name,
      label: entry.name,
      depth: path === rootPath ? 0 : (path.match(/\//g) || []).length - (rootPath.match(/\//g) || []).length,
    }));
    setNodes(prev => {
      const merged = [...prev];
      const existingKeys = new Set(merged.map(n => n.key));
      treeNodes.forEach(n => { if (!existingKeys.has(n.key)) merged.push(n); });
      return merged;
    });
    if (parentExpanded) setExpanded(prev => ({ ...prev, [path]: true }));
    setLoading(false);
  }, [rootPath]);

  useEffect(() => {
    if (rootPath) loadTree(rootPath, true);
  }, [rootPath]);

  const toggleDir = async (node) => {
    if (node.type === 'dir') {
      setExpanded(prev => ({ ...prev, [node.path]: !prev[node.path] }));
      if (!nodes.find(n => n.path === node.path + '/' + node.name)) {
        const entries = await fetchDir(node.path + '/' + node.name);
        const children = entries.map(e => ({ ...e, path: node.path + '/' + e.name, key: e.name, depth: node.depth + 1 }));
        setNodes(prev => [...prev.filter(n => n.depth <= node.depth), ...children.filter(c => !prev.some(p => p.key === c.key))]);
      }
    }
  };

  if (!rootPath) {
    return (
      <div className="py-3 px-2 border-[2px] border-dashed border-[#ddd] text-center">
        <Folder size={16} className="mx-auto text-[#ddd] mb-1" />
        <p className="font-mono text-[7px] text-[#aaa] uppercase">No root set</p>
        <p className="font-mono text-[7px] text-[#ccc] mt-0.5">Set a project folder path below</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-2 mb-1">
        <button onClick={() => loadTree(rootPath, true)} className="p-1 hover:text-[#22c55e] transition-colors" title="Refresh">
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
        </button>
        <span className="font-mono text-[6px] text-[#aaa] uppercase truncate max-w-[120px]" title={rootPath}>{rootPath.split('/').pop()}</span>
      </div>
      <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-0.5">
        {nodes.filter(n => n.depth === 0).map(node => (
          <FileTreeNode
            key={node.key}
            node={node}
            expanded={expanded}
            onToggle={toggleDir}
            onSelect={onFileSelect}
            selectedFile={selectedFile}
            depth={0}
          />
        ))}
        {!loading && nodes.length === 0 && rootPath && (
          <p className="font-mono text-[7px] text-[#aaa] px-2 text-center py-2">No files found</p>
        )}
      </div>
    </div>
  );
};

const FileTreeNode = ({ node, expanded, onToggle, onSelect, selectedFile, depth }) => {
  const isDir = node.type === 'dir';
  const isExpanded = expanded[node.path];
  const isSelected = selectedFile === node.path + '/' + node.name;

  return (
    <div>
      <div
        onClick={() => isDir ? onToggle(node) : onSelect(node.path + '/' + node.name)}
        className={`flex items-center gap-1 px-1 py-0.5 cursor-pointer rounded transition-colors group ${isSelected ? 'bg-[#111] text-[#eae7de]' : 'hover:bg-black/5'} ${isDir ? 'font-black' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {isDir ? (
          <ChevronRight size={8} className={`text-[#aaa] flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        ) : (
          <span className="w-2 flex-shrink-0" />
        )}
        <span className="font-mono text-[8px] truncate">{node.name}</span>
      </div>
      {isDir && isExpanded && node.children && node.children.map(child => (
        <FileTreeNode
          key={child.key}
          node={child}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          selectedFile={selectedFile}
          depth={depth + 1}
        />
      ))}
    </div>
  );
};

// --- Session Memory Panel ---
const MemoryPanel = ({ namespace, setNamespace, vars, setVars, onClose }) => {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const addVar = () => {
    if (!newKey.trim()) return;
    setVars(prev => [...prev, { key: newKey.trim(), value: newVal }]);
    setNewKey('');
    setNewVal('');
  };

  const removeVar = (idx) => setVars(prev => prev.filter((_, i) => i !== idx));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="border-[3px] border-[#111] bg-white shadow-[6px_6px_0_0_#111] p-4 max-w-md mx-auto"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-[#111]" />
          <span className="font-mono text-[10px] font-black uppercase">Session_Memory</span>
        </div>
        <button onClick={onClose} className="p-1 hover:text-[#22c55e] transition-colors"><X size={14} /></button>
      </div>

      {/* Namespace */}
      <div className="mb-4">
        <label className="font-mono text-[8px] font-black uppercase text-[#888] block mb-1">PROJECT_NAMESPACE</label>
        <input
          type="text"
          value={namespace}
          onChange={e => setNamespace(e.target.value)}
          placeholder="e.g. my-portfolio-site"
          className="w-full bg-[#f5f5f0] border-[2px] border-[#111] px-3 py-2 font-mono text-[10px] focus:outline-none focus:border-[#22c55e]"
        />
      </div>

      {/* Context vars */}
      <div className="space-y-2 mb-4">
        <label className="font-mono text-[8px] font-black uppercase text-[#888]">CONTEXT_VARIABLES ({vars.length})</label>
        {vars.map((v, i) => (
          <div key={i} className="flex items-center gap-2 p-2 bg-[#f5f5f0] border-[2px] border-[#ddd]">
            <span className="font-mono text-[9px] font-black text-[#22c55e]">{v.key}:</span>
            <span className="font-mono text-[9px] text-[#111] flex-1 truncate">{v.value}</span>
            <button onClick={() => removeVar(i)} className="text-[#ef4444] hover:text-[#111] transition-colors"><Trash2 size={10} /></button>
          </div>
        ))}
      </div>

      {/* Add new */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="KEY"
          className="flex-1 bg-[#f5f5f0] border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]"
          onKeyDown={e => e.key === 'Enter' && addVar()}
        />
        <input
          type="text"
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          placeholder="value"
          className="flex-[2] bg-[#f5f5f0] border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]"
          onKeyDown={e => e.key === 'Enter' && addVar()}
        />
        <button onClick={addVar} className="px-3 py-1.5 bg-[#22c55e] text-[#111] border-[2px] border-[#111] font-mono text-[9px] font-black hover:bg-[#111] hover:text-[#22c55e] transition-colors">ADD</button>
      </div>

      {vars.length > 0 && (
        <p className="mt-3 font-mono text-[7px] text-[#888] text-center">
          These variables are prepended to every message.
        </p>
      )}
    </motion.div>
  );
};

// --- The High-Fidelity 80m ATM Mascot (Beige Retro Aesthetic) ---
const AtmMascot = ({ state = 'default', isIntro = false }) => {
  return (
    <motion.div
      layoutId="shared-mascot"
      className={`w-full h-full flex items-center justify-center atm-container ${isIntro ? 'mascot-intro-wrapper' : `atm-container anim-${state}`}`}
    >
      <style>{`
        /* Master Floating */
        @keyframes master-hover { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-30px); } }
        @keyframes shadow-pulse { 0%, 100% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(0.85); opacity: 0.15; } }

        /* Intro Swoop */
        @keyframes fly-in-swoop {
            0% { transform: translate3d(2500px, -1800px, -12000px) rotateZ(-40deg) rotateY(-30deg) scale(0); opacity: 0; filter: blur(50px) brightness(10); }
            25% { opacity: 1; filter: blur(15px) brightness(5); }
            65% { transform: translate3d(-500px, 400px, -2000px) rotateZ(20deg) rotateY(15deg) scale(0.85); filter: blur(2px) brightness(2); }
            88% { transform: translate3d(0, 0, 300px) rotateZ(0deg) rotateY(0deg) scale(1.18); filter: blur(0) brightness(1.2); }
            100% { transform: translate3d(0, 0, 0) rotateZ(0deg) rotateY(0deg) scale(1); opacity: 1; filter: blur(0) brightness(1); }
        }
        @keyframes shockwave {
            0% { opacity: 0; transform: scale(0.1) translateZ(0); border-width: 30px; }
            40% { opacity: 0.7; }
            100% { opacity: 0; transform: scale(3.5) translateZ(-200px); border-width: 1px; }
        }
        @keyframes ring-pulse {
            0% { opacity: 0; transform: scale(0.5); border-width: 8px; }
            50% { opacity: 0.8; }
            100% { opacity: 0; transform: scale(2); border-width: 2px; }
        }

        /* Body Parts */
        @keyframes flutter-left { 0% { transform: rotate(0deg); } 100% { transform: rotate(-35deg); } }
        @keyframes flutter-right { 0% { transform: rotate(0deg); } 100% { transform: rotate(35deg); } }
        @keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(0.1); } }
        @keyframes zzz-float { 0% { transform: translateY(0) scale(0.8); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(-100px) scale(1.5); opacity: 0; } }
        @keyframes scan-line-anim { 0% { transform: translateY(0); } 100% { transform: translateY(200px); } }
        @keyframes typing-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(8px); } }
        @keyframes shake-anim { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-15px) rotate(-2deg); } 75% { transform: translateX(15px) rotate(2deg); } }
        @keyframes jump-anim { 0%, 100% { transform: translateY(0) scale(1, 1); } 20% { transform: translateY(30px) scale(1.1, 0.9); } 50% { transform: translateY(-250px) scale(0.9, 1.1); } 80% { transform: translateY(0) scale(1.05, 0.95); } }
        @keyframes bill-rain { 0% { transform: translateY(-20px) skewX(0); opacity: 0; } 10% { opacity: 1; } 100% { transform: translateY(180px) skewX(5deg); opacity: 0; } }
        @keyframes claw-snap { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(25deg); } }

        .mascot-intro-wrapper { animation: fly-in-swoop 2.8s cubic-bezier(0.2, 0.1, 0.2, 1) forwards; transform-style: preserve-3d; }
        .impact-ring { position: absolute; width: 600px; height: 600px; border: 12px solid #22c55e; border-radius: 50%; opacity: 0; pointer-events: none; animation: shockwave 0.9s ease-out 2.1s forwards; }
        .impact-ring-2 { position: absolute; width: 400px; height: 400px; border: 8px solid #22c55e; border-radius: 50%; opacity: 0; pointer-events: none; animation: ring-pulse 0.7s ease-out 2.3s forwards; }
        .impact-ring-3 { position: absolute; width: 800px; height: 800px; border: 6px solid #22c55e; border-radius: 50%; opacity: 0; pointer-events: none; animation: ring-pulse 1s ease-out 2.5s forwards; }
        
        .atm-character { animation: master-hover 4.5s ease-in-out infinite; animation-delay: ${isIntro ? '2.8s' : '0s'}; transform-origin: center; }
        .atm-shadow { transform-origin: 400px 920px; animation: shadow-pulse 4.5s ease-in-out infinite; opacity: ${isIntro ? '0' : '1'}; transition: opacity 1s ease-out 2.4s; }
        .wing-left-container { transform-origin: 220px 450px; animation: flutter-left 0.12s ease-in-out infinite alternate; }
        .wing-right-container { transform-origin: 580px 450px; animation: flutter-right 0.12s ease-in-out infinite alternate; }
        .eye-anim { transform-origin: center; transform-box: fill-box; animation: blink 5s infinite; }

        /* State Modifiers */
        .anim-sleep .sleep-zzz-1 { animation: zzz-float 3s linear infinite; }
        .anim-sleep .sleep-zzz-2 { animation: zzz-float 3s linear infinite 1s; }
        .anim-searching .scan-line { animation: scan-line-anim 1.5s linear infinite alternate; }
        .anim-typing .atm-character { animation: typing-bounce 0.15s infinite; }
        .anim-error .atm-character { animation: shake-anim 0.2s infinite; }
        .anim-jump .atm-character { animation: jump-anim 1s cubic-bezier(0.28, 0.84, 0.42, 1); }
        .anim-jackpot .dollar-bill { animation: bill-rain 0.3s linear infinite; }
        .anim-lobster .pincer-move { animation: claw-snap 0.2s infinite; }
        .anim-urgent .atm-character { animation: shake-anim 0.1s infinite; }
        @keyframes look-around { 0%, 100% { transform: translateX(0); } 20%, 40% { transform: translateX(-20px); } 60%, 80% { transform: translateX(20px); } }
        @keyframes key-flash { 0%, 100% { opacity: 0; } 50% { opacity: 0.9; } }
        .anim-processing .eye-anim { animation: look-around 2s ease-in-out infinite; }
        .anim-typing .atm-character { animation: typing-bounce 0.15s infinite; }
        .anim-jump .atm-character { animation: jump-anim 1s cubic-bezier(0.28, 0.84, 0.42, 1); }
        .anim-jump .shadow-jump { animation: shadow-jump 1s ease-in-out; }
        .anim-processing .top-light-glow, .anim-processing .top-light-glow rect { fill: #3b82f6; filter: drop-shadow(0 0 10px #3b82f6); animation: flash-gold 0.4s infinite alternate; }
      `}</style>

      <div className={isIntro ? "mascot-intro-wrapper" : "w-full"}>
        <svg viewBox="-50 -50 900 1150" className="w-full h-auto drop-shadow-2xl overflow-visible">
            <defs>
                <filter id="drop-shadow"><feDropShadow dx="0" dy="25" stdDeviation="20" floodColor="#000000" floodOpacity="0.4" /></filter>
                <linearGradient id="beigeBody" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#d6d2c1" /><stop offset="15%" stopColor="#eae7de" /><stop offset="45%" stopColor="#cbc9ba" /><stop offset="85%" stopColor="#b5b3a3" /><stop offset="100%" stopColor="#8d8b7d" />
                </linearGradient>
                <radialGradient id="screenGrad" cx="50%" cy="40%" r="60%">
                    <stop offset="0%" stopColor="#fff9c4" /><stop offset="30%" stopColor="#ffeb3b" /><stop offset="100%" stopColor="#f57c00" />
                </radialGradient>
                <radialGradient id="blushGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#ff6b6b" stopOpacity="0.9" /><stop offset="100%" stopColor="#ffc9c9" stopOpacity="0" />
                </radialGradient>
                <g id="feather-wing">
                    <path d="M 0,0 C 70,-70 150,-90 220,-110 C 240,-80 210,-40 180,-10 C 220,-5 220,30 180,40 C 210,60 190,90 150,80 C 160,110 130,140 90,120 C 110,150 70,170 30,130 C 20,110 10,60 0,0 Z" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="4" />
                </g>
                <clipPath id="screen-clip"><rect x="235" y="255" width="330" height="200" rx="12" /></clipPath>
            </defs>

            <g className="atm-shadow"><ellipse cx="400" cy="920" rx="320" ry="40" fill="rgba(0,0,0,0.18)" filter="blur(12px)" /></g>

            <g className="atm-character">
                {/* Lobster Claws */}
                <g className="lobster-claws-container" opacity={state === 'lobster' ? 1 : 0}>
                    <g transform="translate(130, 480)">
                        <path d="M 0 0 Q -50 -20 -80 20" fill="none" stroke="#dc2626" strokeWidth="24" strokeLinecap="round"/><path d="M -80 20 C -120 -20 -160 30 -100 80 C -80 90 -60 60 -80 20" fill="#ef4444" stroke="#991b1b" strokeWidth="4"/><g transform="translate(-100, 80)" className="pincer-move"><path d="M 0 0 C -20 30 -60 20 -40 -10 Z" fill="#ef4444" stroke="#991b1b" strokeWidth="4"/></g>
                    </g>
                    <g transform="translate(670, 480) scale(-1, 1)">
                        <path d="M 0 0 Q -50 -20 -80 20" fill="none" stroke="#dc2626" strokeWidth="24" strokeLinecap="round"/><path d="M -80 20 C -120 -20 -160 30 -100 80 C -80 90 -60 60 -80 20" fill="#ef4444" stroke="#991b1b" strokeWidth="4"/><g transform="translate(-100, 80)" className="pincer-move"><path d="M 0 0 C -20 30 -60 20 -40 -10 Z" fill="#ef4444" stroke="#991b1b" strokeWidth="4"/></g>
                    </g>
                </g>

                <g className="wing-left-container"><use href="#feather-wing" transform="translate(190, 420) scale(-1, 1) rotate(15)" /></g>
                <g className="wing-right-container"><use href="#feather-wing" transform="translate(610, 420) scale(1, 1) rotate(-15)" /></g>

                <g filter="url(#drop-shadow)">
                    <rect x="180" y="150" width="440" height="730" rx="50" fill="url(#beigeBody)" stroke="#111" strokeWidth="6" />
                    <path d="M 180 550 Q 180 880 230 880 L 570 880 Q 620 880 620 550 Z" fill="rgba(0,0,0,0.1)" />
                </g>

                <rect x="210" y="230" width="380" height="250" rx="25" fill="#111" />
                <rect x="235" y="255" width="330" height="200" rx="12" fill="url(#screenGrad)" />

                {/* Overlays */}
                <rect x="235" y="255" width="330" height="200" rx="12" fill="#ef4444" opacity={state === 'error' ? 0.7 : 0} style={{ mixBlendMode: 'multiply' }} />
                <rect x="235" y="255" width="330" height="200" rx="12" fill="#0f172a" opacity={state === 'sleep' ? 0.7 : 0} style={{ mixBlendMode: 'multiply' }} />
                <rect x="235" y="255" width="330" height="200" rx="12" fill="#10b981" opacity={state === 'searching' ? 0.5 : 0} style={{ mixBlendMode: 'overlay' }} />

                <g clipPath="url(#screen-clip)"><line x1="235" y1="255" x2="565" y2="255" stroke="#22c55e" strokeWidth="16" className="scan-line" style={{ opacity: state === 'searching' ? 1 : 0 }} /></g>

                <g transform="translate(400, 355)">
                    <ellipse cx="-100" cy="25" rx="45" ry="32" fill="url(#blushGrad)" />
                    <ellipse cx="100" cy="25" rx="45" ry="32" fill="url(#blushGrad)" />

                    <g opacity={state === 'error' || state === 'sleep' || state === 'job-done' || state === 'urgent' || state === 'lobster' || state === 'processing' || state === 'typing' || state === 'jackpot' ? 0 : 1}>
                       <g transform="translate(-70, -5)"><g className="eye-anim"><ellipse rx="16" ry="24" fill="#241400" /><circle cx="-5" cy="-8" r="6" fill="white" opacity="0.9" /></g></g>
                       <g transform="translate(70, -5)"><g className="eye-anim"><ellipse rx="16" ry="24" fill="#241400" /><circle cx="-5" cy="-8" r="6" fill="white" opacity="0.9" /></g></g>
                       <path d="M -28 20 C -15 50, 15 50, 28 20" fill="none" stroke="#241400" strokeWidth="12" strokeLinecap="round" />
                    </g>

                    {state === 'job-done' && (
                        <g><path d="M -80 0 Q -50 -25 -20 0" stroke="#241400" strokeWidth="12" fill="none" strokeLinecap="round" /><path d="M 20 0 Q 50 -25 80 0" stroke="#241400" strokeWidth="12" fill="none" strokeLinecap="round" /><path d="M -25 35 Q 0 80 25 35 Z" fill="#241400" /></g>
                    )}
                    {state === 'sleep' && (
                        <g><line x1="-85" y1="5" x2="-55" y2="5" stroke="#241400" strokeWidth="8" strokeLinecap="round" /><line x1="55" y1="5" x2="85" y2="5" stroke="#241400" strokeWidth="8" strokeLinecap="round" /><circle cx="0" cy="25" r="8" fill="none" stroke="#241400" strokeWidth="6" /></g>
                    )}
                    {state === 'urgent' && (
                        <g><circle cx="-45" cy="10" r="8" fill="#241400" /><circle cx="45" cy="10" r="8" fill="#241400" /><path d="M -75 -40 Q -65 -65 -55 -40 A 10 10 0 0 1 -75 -40 Z" fill="#22d3ee" /></g>
                    )}
                    {state === 'processing' && (
                        <g>
                            <g transform="translate(-70, -5)"><ellipse rx="16" ry="24" fill="#241400" className="eye-anim" /><circle cx="-5" cy="-8" r="6" fill="white" opacity="0.9" /></g>
                            <g transform="translate(70, -5)"><ellipse rx="16" ry="24" fill="#241400" className="eye-anim" /><circle cx="-5" cy="-8" r="6" fill="white" opacity="0.9" /></g>
                            <path d="M -28 20 C -15 50, 15 50, 28 20" fill="none" stroke="#241400" strokeWidth="12" strokeLinecap="round" />
                        </g>
                    )}
                    {state === 'typing' && (
                        <g>
                            <ellipse cx="-40" cy="5" rx="14" ry="20" fill="#241400" /><circle cx="-35" cy="12" r="4" fill="#ffffff" />
                            <ellipse cx="40" cy="5" rx="14" ry="20" fill="#241400" /><circle cx="45" cy="12" r="4" fill="#ffffff" />
                            <line x1="-15" y1="30" x2="15" y2="30" stroke="#241400" strokeWidth="7" strokeLinecap="round" />
                        </g>
                    )}
                    {state === 'jackpot' && (
                        <g>
                            <path d="M -90 0 Q -70 -20 -50 0 Q -70 -10 -90 0" fill="none" stroke="#241400" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M 50 0 Q 70 -20 90 0 Q 70 -10 50 0" fill="none" stroke="#241400" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M -20 15 Q 0 50 20 15 Z" fill="#241400" /><path d="M -10 25 Q 0 40 10 25 Z" fill="#ef4444" />
                        </g>
                    )}
                    {state === 'error' && (
                        <g>
                            <path d="M -90 -10 L -50 10 M -90 10 L -50 -10" fill="none" stroke="#241400" strokeWidth="9" strokeLinecap="round" />
                            <path d="M 50 10 L 90 -10 M 50 -10 L 90 10" fill="none" stroke="#241400" strokeWidth="9" strokeLinecap="round" />
                            <path d="M -20 30 L -10 20 L 0 30 L 10 20 L 20 30" fill="none" stroke="#241400" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
                        </g>
                    )}
                    {state === 'searching' && (
                        <g>
                            <circle cx="-40" cy="-5" r="18" fill="none" stroke="#241400" strokeWidth="6" /><circle cx="40" cy="-5" r="18" fill="none" stroke="#241400" strokeWidth="6" />
                            <line x1="-22" y1="-5" x2="22" y2="-5" stroke="#241400" strokeWidth="6" /><circle cx="-48" cy="-5" r="5" fill="#241400" /><circle cx="32" cy="-5" r="5" fill="#241400" />
                            <path d="M -15 25 Q 0 35 15 25" fill="none" stroke="#241400" strokeWidth="6" strokeLinecap="round" />
                        </g>
                    )}
                    {state === 'lobster' && (
                        <g>
                            <path d="M -30 -50 Q -50 -90 -80 -70" fill="none" stroke="#ef4444" strokeWidth="8" strokeLinecap="round" /><path d="M 30 -50 Q 50 -90 80 -70" fill="none" stroke="#ef4444" strokeWidth="8" strokeLinecap="round" />
                            <circle cx="-80" cy="-70" r="6" fill="#ef4444" /><circle cx="80" cy="-70" r="6" fill="#ef4444" />
                            <path d="M -60 -5 L -20 10" fill="none" stroke="#241400" strokeWidth="10" strokeLinecap="round" /><path d="M 60 -5 L 20 10" fill="none" stroke="#241400" strokeWidth="10" strokeLinecap="round" />
                            <circle cx="-40" cy="5" r="10" fill="#241400" /><circle cx="40" cy="5" r="10" fill="#241400" />
                            <path d="M -10 30 Q 0 20 10 30" fill="none" stroke="#241400" strokeWidth="6" strokeLinecap="round" />
                        </g>
                    )}
                </g>

                <g className="sleep-zzzs" opacity={state === 'sleep' ? 1 : 0}>
                    <text x="500" y="200" fontSize="50" fontFamily="Arial Rounded MT Bold" fill="#cbd5e1" className="sleep-zzz-1">Z</text>
                    <text x="540" y="150" fontSize="40" fontFamily="Arial Rounded MT Bold" fill="#94a3b8" className="sleep-zzz-2">z</text>
                </g>

                <g transform="translate(400, 520)">
                    {[0, 1, 2].map(row => [0, 1, 2, 3].map(col => (
                        <rect key={`${row}-${col}`} x={col * 42} y={row * 30} width="36" height="24" rx="4" fill={col === 3 ? (row === 0 ? '#ef4444' : row === 1 ? '#eab308' : '#22c55e') : '#111'} stroke="#111" strokeWidth="2" />
                    )))}
                </g>

                <g className="dollar-bill-group">
                    <path className="dollar-bill" d="M 280 750 L 520 750 L 525 830 Q 400 850 275 830 Z" fill="#dcfce7" stroke="#22c55e" strokeWidth="3" opacity={state === 'jackpot' ? 1 : 0.4} />
                </g>

                <g transform="translate(600, 210)"><text x="0" y="0" fontWeight="900" fontSize="52" fill="white" textAnchor="end" style={{ textShadow: '2px 2px 0px #111' }}>80m</text></g>

                {/* Top Light — glowing indicator */}
                <g transform="translate(400, 195)">
                    <rect x="-45" y="0" width="90" height="12" rx="6" fill="#1e293b" />
                    <rect x="-42" y="2" width="84" height="8" rx="4" fill="#22c55e" className="top-light-glow" />
                </g>
            </g>
        </svg>
        {isIntro && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="impact-ring top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            <div className="impact-ring-2 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            <div className="impact-ring-3 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
        )}
      </div>
    </motion.div>
  );
};

// --- Header Dynamic Status Frame ---
const HeaderStatusFrame = ({ state }) => {
  const statusLabels = {
    default: "IDLE",
    processing: "PARSING",
    searching: "SCRAPING",
    typing: "WRITING",
    jobDone: "DONE",
    sleep: "SLEEP",
    urgent: "URGENT"
  };

  return (
    <div className="flex items-start gap-1 pointer-events-none">
      <div className="relative">
        <div
          className="absolute bg-[#050505] rounded-[1px] flex items-center justify-center overflow-hidden shadow-[inset_0_0_15px_rgba(34,197,94,0.5)]"
          style={{ top: "29.2%", bottom: "28%", left: "16.5%", right: "36.5%" }}
        >
          <div className="absolute inset-0 bg-[linear-gradient(rgba(34,197,94,0.15),rgba(34,197,94,0.15)_50%,rgba(0,0,0,0.5)_50%,rgba(0,0,0,0.5))] bg-[length:100%_4px] pointer-events-none"></div>
          <p className="font-mono text-[7px] lg:text-[9px] text-[#22c55e] font-black tracking-tighter leading-none text-center px-1 uppercase animate-pulse">
            {statusLabels[state] || "READY"}
          </p>
        </div>
        <img src="https://i.postimg.cc/d18ByxQX/Beige-ATM-with-transparent-screen.png" alt="Frame" className="h-16 lg:h-20 w-auto object-contain filter drop-shadow-lg" />
      </div>
    </div>
  );
};

// --- PR-3: Onboarding wizard ---
const ONBOARDING_STEPS = [
  { title: 'Welcome to 80M', desc: 'This quick wizard will connect Hermes and tune your workspace.', mascotState: 'jump' },
  { title: 'Configure Endpoints', desc: 'Open Settings → Connection and save Hermes, Local API, and Webhook bases.', mascotState: 'processing' },
  { title: 'Run Health Check', desc: 'Use "Run System Diagnostics" to verify Hermes sessions, fs, and webhooks.', mascotState: 'searching' },
  { title: 'Execute First Prompt', desc: 'Pick an agent and send a test task. You are now mission-ready.', mascotState: 'job-done' },
];

const OnboardingWizard = ({ step, onNext, onBack, onFinish }) => {
  const current = ONBOARDING_STEPS[step] || ONBOARDING_STEPS[0];
  const isLast = step === ONBOARDING_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl border-[4px] border-[#111] bg-[#eae7de] shadow-[10px_10px_0_0_#111] grid lg:grid-cols-[1fr_1.2fr] gap-4 p-4">
        <div className="h-64 lg:h-[420px] border-[3px] border-[#111] bg-white p-2">
          <AtmMascot state={current.mascotState} />
        </div>
        <div className="flex flex-col justify-between p-2 space-y-4">
          <div className="space-y-3">
            <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-[#22c55e]">
              Setup_Wizard {step + 1}/{ONBOARDING_STEPS.length}
            </p>
            <h2 className="font-serif text-3xl font-black text-[#111] tracking-tight">{current.title}</h2>
            <p className="font-mono text-sm text-[#333] leading-relaxed">{current.desc}</p>
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={onBack}
              disabled={step === 0}
              className="px-4 py-2 border-[3px] border-[#111] bg-white font-mono text-[10px] font-black uppercase disabled:opacity-40"
            >
              Back
            </button>
            {isLast ? (
              <button onClick={onFinish} className="px-5 py-2 border-[3px] border-[#111] bg-[#22c55e] font-mono text-[10px] font-black uppercase">
                Finish Setup
              </button>
            ) : (
              <button onClick={onNext} className="px-5 py-2 border-[3px] border-[#111] bg-[#111] text-[#22c55e] font-mono text-[10px] font-black uppercase">
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const MessageMarkdown = ({ content, role = 'assistant' }) => {
  const isUser = role === 'user';
  const baseText = isUser ? 'text-[#111]' : 'text-[#e8e8ec]';

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ ...props }) => <h1 className={`font-serif text-xl lg:text-2xl font-black tracking-tight mt-2 mb-3 ${baseText}`} {...props} />,
        h2: ({ ...props }) => <h2 className={`font-serif text-lg lg:text-xl font-black tracking-tight mt-4 mb-2 ${baseText}`} {...props} />,
        h3: ({ ...props }) => <h3 className={`font-mono text-sm lg:text-base font-black uppercase tracking-[0.08em] mt-4 mb-2 ${baseText}`} {...props} />,
        p: ({ ...props }) => <p className={`font-mono text-sm lg:text-base leading-relaxed mb-3 last:mb-0 ${baseText}`} {...props} />,
        ul: ({ ...props }) => <ul className={`list-disc pl-6 space-y-1 mb-3 ${baseText}`} {...props} />,
        ol: ({ ...props }) => <ol className={`list-decimal pl-6 space-y-1 mb-3 ${baseText}`} {...props} />,
        li: ({ ...props }) => <li className="font-mono text-sm lg:text-base leading-relaxed" {...props} />,
        blockquote: ({ ...props }) => (
          <blockquote className={`border-l-4 ${isUser ? 'border-[#111]/50 bg-[#111]/5' : 'border-[#22c55e]/50 bg-[#111]/35'} px-3 py-2 my-3 italic`} {...props} />
        ),
        code: ({ inline, className, children, ...props }) => (
          inline ? (
            <code className={`${isUser ? 'bg-[#111]/10' : 'bg-[#111]/70'} px-1.5 py-0.5 rounded font-mono text-xs`} {...props}>
              {children}
            </code>
          ) : (
            <code className={`${className || ''}`} {...props}>{children}</code>
          )
        ),
        pre: ({ ...props }) => (
          <pre className={`${isUser ? 'bg-[#111]/10 text-[#111]' : 'bg-[#111]/70 text-[#e8e8ec]'} border border-[#3a3a3e] rounded-xl p-3 overflow-x-auto mb-3 font-mono text-xs`} {...props} />
        ),
        hr: ({ ...props }) => <hr className={`my-4 ${isUser ? 'border-[#111]/20' : 'border-[#e8e8ec]/20'}`} {...props} />,
      }}
    >
      {content || ''}
    </ReactMarkdown>
  );
};

// =====================================================================
// MAIN APP — Original UI preserved exactly, new features added around it
// =====================================================================
export default function App() {
  // --- New: Config & State ---
  const [config, setConfig] = useState(loadConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [showVault, setShowVault] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showPWAInstall, setShowPWAInstall] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [pwaCanInstall, setPwaCanInstall] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const [messageReaction, setMessageReaction] = useState(null);
  const [hoveredMsgId, setHoveredMsgId] = useState(null);
  const [cmdSearch, setCmdSearch] = useState('');
  const [toolEventsByMsg, setToolEventsByMsg] = useState({}); // msgId -> array of tool events
  const [expandedTools, setExpandedTools] = useState({}); // `${msgId}-${toolIndex}` -> bool
  const [splitView, setSplitView] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [previewFilePath, setPreviewFilePath] = useState('');
  const [showPathInput, setShowPathInput] = useState(false);
  const [pathInputValue, setPathInputValue] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('80m-onboarding-complete'));
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [messageCount, setMessageCount] = useState(0);

  // --- Offline support ---
  const [queuedCount, setQueuedCount] = useState(() => getQueue().length);
  const { isOnline, isHermesConnected, queueCount } = useOffline();
  const { flushQueue, checkConnection, fetchFsList } = useHermesApi();

  // --- Projects ---
  const [projects, setProjects] = useState(() => {
    try { return JSON.parse(localStorage.getItem('80m-projects')) || []; } catch { return []; }
  });
  const [activeProject, setActiveProject] = useState(() => localStorage.getItem('80m-active-project') || null);
  const [projectTodos, setProjectTodos] = useState(() => {
    try { return JSON.parse(localStorage.getItem('80m-todos')) || []; } catch { return []; }
  });
  const [projectNotes, setProjectNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('80m-notes')) || ''; } catch { return ''; }
  });
  const [projectRoot, setProjectRoot] = useState(() => localStorage.getItem('80m-project-root') || '');
  const [fileTree, setFileTree] = useState([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  // --- Per-project memory (derived after activeProject) ---
  const [projectMemories, setProjectMemories] = useState(() => {
    try { return JSON.parse(localStorage.getItem('80m-project-memories')) || {}; } catch { return {}; }
  });
  const currentMemory = activeProject ? (projectMemories[activeProject] || { namespace: '', vars: [] }) : { namespace: '', vars: [] };
  const projectNamespace = currentMemory.namespace;
  const contextVars = currentMemory.vars;
  const setProjectNamespace = (ns) => {
    if (!activeProject) return;
    setProjectMemories(prev => ({
      ...prev,
      [activeProject]: { ...(prev[activeProject] || { namespace: '', vars: [] }), namespace: ns },
    }));
  };
  const setContextVars = (vars) => {
    if (!activeProject) return;
    setProjectMemories(prev => ({
      ...prev,
      [activeProject]: { ...(prev[activeProject] || { namespace: '', vars: [] }), vars },
    }));
  };
  const [showMemory, setShowMemory] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [showMCP, setShowMCP] = useState(false);

  const scrollRef = useRef(null);

  const [messages, _rawSetMessages] = useState(() => loadMessages());
  const messageIdRef = useRef(0);
  useEffect(() => {
    const maxExistingId = messages.reduce((maxId, msg) => {
      const parsed = Number(msg?.id);
      return Number.isFinite(parsed) ? Math.max(maxId, parsed) : maxId;
    }, 0);
    if (maxExistingId > messageIdRef.current) messageIdRef.current = maxExistingId;
  }, [messages]);
  const nextMessageId = useCallback(() => {
    const now = Date.now();
    messageIdRef.current = Math.max(now, messageIdRef.current + 1);
    return messageIdRef.current;
  }, []);
  // Wrap setMessages to update ref + localStorage synchronously on every update
  const setMessages = useCallback((update) => {
    _rawSetMessages(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      _setMessagesRef(next);
      saveMessages(next);
      return next;
    });
  }, []);
  const [inputValue, setInputValue] = useState('');

  // --- New: Build agents from config ---
  const employees = config.agents.map(a => ({
    id: a.id,
    icon: ICON_MAP[a.icon] || Bot,
    role: a.role,
    color: a.color,
  }));

  // --- Original: Core State ---
  const [agentState, setAgentState] = useState('default');
  const [agentThinking, setAgentThinking] = useState(false);
  const [activeEmployee, setActiveEmployee] = useState(config.agents[0]?.id || 'prawnius');
  const [loadPhase, setLoadPhase] = useState('logo');
  const [viewMode, setViewMode] = useState('session'); // 'session' or 'history'

  // --- Voice input state (Shift+Space hold-to-record) ---
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef(false);
  const recognitionRef = useRef(null);
  const mascotTimerRef = useRef(null);
  const [voiceError, setVoiceError] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const spokenMessageIdsRef = useRef(new Set());

  // --- New: Audio feedback (Web Audio API) ---
  const { unlock, playSendClick, playAgentChime } = useAudio();

  const pulseMascot = useCallback((state, holdMs = 1200) => {
    setAgentState(state);
    if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current);
    mascotTimerRef.current = setTimeout(() => setAgentState('default'), holdMs);
  }, []);

  useEffect(() => () => {
    if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current);
  }, []);

  // Unlock audio on first user interaction
  useEffect(() => {
    const events = ['pointerdown', 'keydown', 'touchstart'];
    const handle = () => { unlock(); events.forEach(e => document.removeEventListener(e, handle)); };
    events.forEach(e => document.addEventListener(e, handle));
    return () => events.forEach(e => document.removeEventListener(e, handle));
  }, [unlock]);

  // --- New: Process offline queue when Hermes reconnects ---
  useEffect(() => {
    if (isHermesConnected) {
      const queue = getQueue();
      setQueuedCount(queue.length);
      if (queue.length > 0) flushQueue();
    }
  }, [isHermesConnected, flushQueue]);

  // Play agent chime when a new assistant message arrives
  const prevMessagesLenRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessagesLenRef.current) {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') playAgentChime();
    }
    prevMessagesLenRef.current = messages.length;
  }, [messages, playAgentChime]);

  // --- Browser-native natural TTS for assistant replies ---
  const speakText = useCallback((text) => {
    if (!text || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(v =>
      /en-US/i.test(v.lang) && /(natural|neural|samantha|google us english|aria|jenny|zira)/i.test(v.name)
    ) || voices.find(v => /en-US/i.test(v.lang)) || voices[0];
    if (naturalVoice) utterance.voice = naturalVoice;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!ttsEnabled || !last || last.role !== 'assistant' || spokenMessageIdsRef.current.has(last.id)) return;
    spokenMessageIdsRef.current.add(last.id);
    const spokenText = String(last.content || '')
      .replace(/```[\s\S]*?```/g, ' code block omitted ')
      .replace(/[#>*_`~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (spokenText) speakText(spokenText);
  }, [messages, speakText, ttsEnabled]);

  useEffect(() => () => {
    window.speechSynthesis?.cancel();
  }, []);

  // --- Voice input: start recording ---
  const startRecording = useCallback(() => {
    if (recordingRef.current) return;
    try {
      window.speechSynthesis?.cancel();
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setVoiceError('Voice input is not supported in this browser.');
        return;
      }
      setVoiceError('');

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        recordingRef.current = true;
        setIsRecording(true);
      };

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript.trim()) {
          setInputValue(prev => prev + transcript);
        }
      };

      recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
          setVoiceError('Microphone permission denied. Please allow mic access.');
        }
        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
          recordingRef.current = false;
          setIsRecording(false);
        }
      };

      recognition.onend = () => {
        recordingRef.current = false;
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (_) {
      recordingRef.current = false;
    }
  }, []);

  // --- Voice input: stop recording and send ---
  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    try {
      recognitionRef.current?.stop();
    } catch (_) {}
    recordingRef.current = false;
    setIsRecording(false);
    // Small delay so the last transcript flushes
    setTimeout(() => {
      if (inputValue.trim()) {
        unlock();
        handleSend({ preventDefault: () => {} });
      }
    }, 120);
  }, [inputValue, unlock]);

  const toggleRecording = useCallback(() => {
    if (recordingRef.current) {
      stopRecording();
      return;
    }
    startRecording();
  }, [startRecording, stopRecording]);

  // --- New: PWA install prompt handling ---
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      deferredPrompt = e;
      setShowPWAInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // --- New: Check API connectivity ---
  useEffect(() => {
    if (!config.apiEnabled || !config.apiEndpoint) {
      setConnectionStatus('disabled');
      return;
    }
    setConnectionStatus('checking');
    fetch(config.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'ping', agent_id: activeEmployee }),
      signal: AbortSignal.timeout(5000),
    })
      .then(() => setConnectionStatus('connected'))
      .catch(() => setConnectionStatus('error'));
  }, [config.apiEnabled, config.apiEndpoint]);

  // --- Original: Intro animation phases ---
  useEffect(() => {
    const t1 = setTimeout(() => setLoadPhase('swoop'), 1500);
    const t2 = setTimeout(() => setLoadPhase('ready'), 4600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // --- Original: Auto-scroll ---
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, agentState]);

  // --- New: Save messages on change ---
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  // --- New: Save config on change ---
  useEffect(() => {
    saveConfig(config);
  }, [config]);

  // --- New: Persist memory state ---
  useEffect(() => { localStorage.setItem('80m-project-memories', JSON.stringify(projectMemories)); }, [projectMemories]);

  // --- New: Persist projects ---
  useEffect(() => { localStorage.setItem('80m-projects', JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem('80m-active-project', activeProject || ''); }, [activeProject]);
  useEffect(() => { localStorage.setItem('80m-todos', JSON.stringify(projectTodos)); }, [projectTodos]);
  useEffect(() => { localStorage.setItem('80m-notes', projectNotes); }, [projectNotes]);
  useEffect(() => { localStorage.setItem('80m-project-root', projectRoot); }, [projectRoot]);

  // --- New: Update activeEmployee when config agents change ---
  useEffect(() => {
    const agentExists = config.agents.find(a => a.id === activeEmployee);
    if (!agentExists && config.agents.length > 0) {
      setActiveEmployee(config.agents[0].id);
    }
  }, [config.agents]);

  // --- New: Keyboard shortcut (Ctrl+K for command palette) ---
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(v => !v);
        setCmdSearch('');
      }
      if (e.key === 'Escape') setShowCommandPalette(false);
      // Shift+Space → start voice recording
      if (e.shiftKey && e.key === ' ') {
        e.preventDefault();
        startRecording();
      }
    };
    const keyUpHandler = (e) => {
      // Space-up while shift held → stop voice recording
      if (e.key === ' ' && recordingRef.current) {
        stopRecording();
      }
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', keyUpHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', keyUpHandler);
    };
  }, [startRecording, stopRecording]);

  // --- New: Handle PWA install ---
  const handlePWAInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    setPwaCanInstall(false);
    setShowPWAInstall(false);
  };

  const finishOnboarding = () => {
    localStorage.setItem('80m-onboarding-complete', '1');
    setShowOnboarding(false);
    pulseMascot('job-done', 1600);
  };

  // --- Command palette actions ---
  const runSystemDiagnostics = async () => {
    const check = async (name, fn) => {
      const started = performance.now();
      try {
        await fn();
        return { name, ok: true, ms: Math.round(performance.now() - started) };
      } catch (error) {
        return { name, ok: false, ms: Math.round(performance.now() - started), error: error.message };
      }
    };

    setAgentState('processing');
    const checks = await Promise.all([
      check('Hermes /sessions', async () => {
        const ok = await checkConnection();
        if (!ok) throw new Error('Hermes unreachable');
      }),
      check('Hermes /fs/list', async () => {
        const fs = await fetchFsList('/');
        if (!fs) throw new Error('No response');
      }),
      check('Webhook Service /webhooks', async () => {
        const res = await fetch(`${WEBHOOK_BASE}/webhooks`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }),
    ]);

    const queue = getQueue();
    const passed = checks.filter(c => c.ok).length;
    const summary = [
      '## System Diagnostics',
      '',
      `**Checks passed:** ${passed}/${checks.length}`,
      `**Queue depth:** ${queue.length}`,
      '',
      ...checks.map(c => `- ${c.ok ? '✅' : '❌'} **${c.name}** (${c.ms}ms)${c.ok ? '' : ` — ${c.error}`}`),
      '',
      queue.length > 0 ? `- ⚠️ ${queue.filter(i => i.status === 'dead-letter').length} dead-letter messages need manual review.` : '- ✅ Queue is empty.',
    ].join('\n');

    setMessages(prev => [...prev, {
      id: nextMessageId(),
      role: 'assistant',
      employee: activeEmployee,
      content: summary,
    }]);
    // Both our state update and mascot pulse for diagnostics completion
    setAgentState('job-done');
    setTimeout(() => setAgentState('default'), 1200);
    pulseMascot(passed === checks.length ? 'job-done' : 'urgent', 1500);
  };

  const commandActions = [
    { label: 'New Conversation', icon: <MessageSquare size={14} />, action: () => { createConversation(); setShowCommandPalette(false); } },
    { label: 'Open Knowledge Vault', icon: <Database size={14} />, action: () => { setShowVault(true); setShowCommandPalette(false); } },
    { label: 'Open Skills Module', icon: <Zap size={14} />, action: () => { setShowSkills(true); setShowCommandPalette(false); } },
    { label: 'Open Session Memory', icon: <Brain size={14} />, action: () => { setShowMemory(true); setShowCommandPalette(false); } },
    { label: 'Open Webhooks', icon: <Globe size={14} />, action: () => { setShowWebhook(true); setShowCommandPalette(false); } },
    { label: 'Run System Diagnostics', icon: <Activity size={14} />, action: () => { runSystemDiagnostics(); setShowCommandPalette(false); } },
    { label: 'Settings', icon: <Settings size={14} />, action: () => { setShowSettings(true); setShowCommandPalette(false); } },
    { label: 'Clear Messages', icon: <Trash2 size={14} />, action: () => { setMessages([]); setShowCommandPalette(false); } },
    ...config.agents.map(agent => ({
      label: `Switch to ${agent.id}`, icon: <Bot size={14} />, action: () => { setActiveEmployee(agent.id); setShowCommandPalette(false); }
    })),
  ];
  const filteredCommands = commandActions.filter(c => c.label.toLowerCase().includes(cmdSearch.toLowerCase()));

  // --- New: Copy message ---
  const handleCopyMessage = (msg) => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // --- Original: Send message ---
  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const contextPrefix = contextVars.length > 0
      ? `[${projectNamespace || 'global'}] `
      : '';
    const displayMsg = contextPrefix + inputValue;
    const userMsgId = nextMessageId();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: displayMsg }]);
    setInputValue('');
    playSendClick();
    pulseMascot('jump', 500);
    if (inputValue.toLowerCase().includes('lobster')) pulseMascot('lobster', 1800);

    // If API is enabled, make a real request
    if (config.apiEnabled && config.apiEndpoint) {
      // --- Offline-aware: queue if Hermes is unreachable ---
      if (!isHermesConnected || !isOnline) {
        const queuedId = queueMessage({ text: displayMsg, agent: activeEmployee });
        const assistantMsgId = nextMessageId();
        setMessages(prev => [...prev, {
          id: assistantMsgId,
          role: 'assistant',
          employee: activeEmployee,
          content: `[Message queued — will send when Hermes reconnects. Queue: ${queueCount + 1}]`,
        }]);
        setQueuedCount(q => q + 1);
        pulseMascot('sleep', 1600);
        return;
      }

      setAgentState('processing');
      setAgentThinking(true);
      const assistantMsgId = nextMessageId();
      setToolEventsByMsg(prev => ({ ...prev, [assistantMsgId]: [] }));

      // Add placeholder assistant message (empty, we'll fill it when the job completes)
      setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', employee: activeEmployee, content: '' }]);

      try {
        const contextBlock = contextVars.length > 0
          ? `\n[PROJECT CONTEXT — ${projectNamespace || 'global'}]\n${contextVars.map(v => `${v.key}: ${v.value}`).join('\n')}\n[/CONTEXT]\n`
          : '';
        const fullMessage = contextBlock + inputValue;

        const submitRes = await fetch(config.apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildApiPayload({ endpoint: config.apiEndpoint, message: fullMessage, agentId: activeEmployee })),
          signal: AbortSignal.timeout(30000),
        });

        if (!submitRes.ok) throw new Error(`HTTP ${submitRes.status}`);
        const submitData = await submitRes.json();
        const jobId = submitData.job_id;
        if (jobId) {
          pulseMascot('searching', 1200);
          let completed = false;
          const streamed = await tryStreamJobViaSSE({ baseUrl: HERMES_BASE, jobId });
          if (streamed?.completed) {
            setToolEventsByMsg(prev => ({ ...prev, [assistantMsgId]: streamed.events || [] }));
            setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: streamed.responseText || '[No response returned]' } : m));
            completed = true;
          }

          // SSE unavailable or unsupported by backend: fallback to status polling.
          if (!completed) {
            for (let i = 0; i < 300; i++) {
              await new Promise(r => setTimeout(r, 1000));
              const statusRes = await fetch(`${HERMES_BASE}/chat/status/${jobId}`, {
                signal: AbortSignal.timeout(10000),
              });
              if (!statusRes.ok) continue;
              const statusData = await statusRes.json();

              if (statusData.status === 'queued' || statusData.status === 'running') {
                setAgentState('typing');
                continue;
              }

              if (statusData.status === 'completed') {
                // Hermes returns { response: "...", events: [...] }
                const responseText = statusData.response || statusData.result?.response || '';
                const events = statusData.events || statusData.result?.events || [];
                setToolEventsByMsg(prev => ({ ...prev, [assistantMsgId]: events.filter(e => e.type === 'tool') }));
                setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: responseText || '[No response returned]' } : m));
                completed = true;
                break;
              }

              if (statusData.status === 'failed') {
                throw new Error(statusData.result?.error || statusData.error || 'Hermes job failed');
              }
            }
          }
          if (!completed) throw new Error('Hermes job timeout');
        } else {
          const responseText = extractAssistantText(submitData);
          if (!responseText) throw new Error('No response payload from endpoint');
          setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: responseText } : m));
        }
        // SSE completion: update state + mascot animation
        setAgentState('job-done');
        setTimeout(() => setAgentState('default'), 1500);
        const nextCount = messageCount + 1;
        setMessageCount(nextCount);
        pulseMascot(nextCount % 5 === 0 ? 'jackpot' : 'job-done', 1500);
      } catch (err) {
        // On error, queue the message for retry instead of showing error
        const queuedId = queueMessage({ text: displayMsg, agent: activeEmployee });
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? {
          ...m,
          content: `[Connection lost — message queued. Will retry when Hermes reconnects.]`,
        } : m));
        setQueuedCount(q => q + 1);
        pulseMascot('error', 1800);
      } finally {
        setAgentThinking(false);
      }
    } else {
      // Demo mode — original animated simulation
      setAgentState('processing');
      const demoMsgId = nextMessageId();
      setTimeout(() => {
        setAgentState('searching');
        const searchEvent = { type: 'tool', tool: 'websearch', input: inputValue, output: 'Found 3 relevant documents' };
        setToolEventsByMsg(prev => ({ ...prev, [demoMsgId]: [searchEvent] }));
      }, 800);
      setTimeout(() => {
          setAgentState('typing');
          const codeEvent = { type: 'tool', tool: 'code_exec', input: 'print("executing...")', output: 'Execution complete' };
          setToolEventsByMsg(prev => ({ ...prev, [demoMsgId]: [...(prev[demoMsgId] || []), codeEvent] }));
          setMessages(prev => [...prev, { id: demoMsgId, role: 'assistant', employee: activeEmployee, content: `Protocol initiated by ${activeEmployee}. Analyzing parameters for "${inputValue}". local server hooks validated.` }]);
      }, 2000);
      setTimeout(() => setAgentState(inputValue.toLowerCase().includes('lobster') ? 'lobster' : 'job-done'), 4000);
      setTimeout(() => setAgentState('default'), 5500);
    }
  };

  // ==================================================================
  // ORIGINAL UI — exactly as provided, with new features overlayed
  // ==================================================================

  // --- OfflineStatusBar: shown when offline or Hermes is down ---
  const OfflineStatusBar = () => {
    if (isOnline && isHermesConnected) return null;
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 px-4 py-2 bg-[#111] text-[#22c55e] font-mono text-[10px] font-black uppercase">
        {!isOnline ? (
          <><WifiOff size={12} /> OFFLINE — Messages will queue until reconnected</>
        ) : (
          <><Activity size={12} /> HERMES OFFLINE — Messages will queue ({queuedCount} pending)</>
        )}
      </div>
    );
  };

  // --- Shared content handler (PWA share target) ---
  const handleShared = (data) => {
    if (data.text) setInputValue(prev => prev ? `${prev} ${data.text}` : data.text);
    if (data.url) setInputValue(prev => prev ? `${prev} ${data.url}` : data.url);
  };

  return (
    <div className="h-screen w-full text-[#111] font-sans flex items-center justify-center overflow-hidden selection:bg-[#111] selection:text-[#eae7de] relative">
      <NoiseOverlay />
      <PaperBackground />
      <ParticleFieldCanvas />
      <OfflineStatusBar />
      <ShareHandler onShared={handleShared} />

      <AnimatePresence>
        {loadPhase === 'logo' && (
          <motion.div key="logo" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.2, filter: 'blur(20px)' }} className="absolute z-[100] flex flex-col items-center gap-4">
            <h1 className="font-serif font-black text-7xl lg:text-9xl tracking-tighter text-[#111]">80<span className="lowercase">m</span><span className="text-[#22c55e]">.</span></h1>
            <div className="w-12 h-1.5 bg-[#22c55e] rounded-full animate-pulse shadow-[0_0_20px_#22c55e]"></div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {loadPhase === 'swoop' && (
          <motion.div key="swoop" exit={{ opacity: 0 }} className="absolute inset-0 z-[90] flex items-center justify-center">
            <div className="max-w-2xl w-full"><AtmMascot isIntro={true} /></div>
          </motion.div>
        )}
      </AnimatePresence>

      {loadPhase === 'ready' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full w-full flex overflow-hidden relative">
          <div className="h-full w-full flex overflow-hidden relative">
            {/* ===== LEFT SIDEBAR ===== */}
            <aside className="w-[70px] lg:w-[320px] bg-transparent border-r-[4px] border-[#111] flex flex-col items-center lg:items-stretch p-2 lg:p-6 z-30 relative overflow-visible">
              {/* Logo + Status Frame + Settings top-right row */}
              <div className="flex items-start justify-between mb-6 lg:mb-8 px-1 lg:px-0">
                <div className="mt-1">
                  <div className="font-[family-name:['Bodoni+Moda',serif]] font-black text-2xl lg:text-4xl tracking-tighter text-[#e8e8ec] leading-none">
                    80<span className="lowercase">M</span><span className="text-[#22c55e]">.</span>
                  </div>
                  <div className="mt-2">
                    <HeaderStatusFrame state={agentState} />
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <button
                    onClick={() => { setSplitView(p => !p); }}
                    className="p-2 text-[#e8e8ec]/50 hover:text-[#22c55e] hover:shadow-[0_0_12px_rgba(34,197,94,0.5)] rounded-lg transition-all duration-300"
                    title="Toggle Preview"
                  >
                    <Eye size={15} strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => setShowSettings(true)}
                    className="p-2 text-[#e8e8ec]/50 hover:text-[#22c55e] hover:shadow-[0_0_12px_rgba(34,197,94,0.5)] rounded-lg transition-all duration-300"
                    title="Settings"
                  >
                    <Settings size={15} strokeWidth={2} />
                  </button>
                </div>
              </div>
              
              {/* Scrollable sidebar content */}
              <div className="flex-1 overflow-y-auto space-y-6 px-1 lg:px-2 custom-scrollbar relative z-10">
                {/* 3 Tab buttons - Session / History / Agents */}
                {/* 3 Tab buttons - Session / History / Agents */}
                <div className="space-y-1">
                  <div className="grid grid-cols-3 gap-1 bg-[#2a2a2e]/60 backdrop-blur-md border border-[#3a3a3e] p-1">
                  <button
                    onClick={() => setViewMode('session')}
                    className={`flex items-center justify-center gap-1 p-2 rounded-lg transition-all ${viewMode === 'session' ? 'bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/40 shadow-[0_0_12px_rgba(34,197,94,0.15)]' : 'text-[#e8e8ec]/40 hover:text-[#e8e8ec]/70'}`}
                  >
                    <Activity size={16} strokeWidth={3} />
                    <span className="hidden lg:block font-sans font-black uppercase text-[9px] tracking-tight">Session</span>
                  </button>
                  
                  <button
                    onClick={() => setViewMode('projects')}
                    className={`flex items-center justify-center gap-1 p-2 rounded-lg transition-all ${viewMode === 'projects' ? 'bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/40 shadow-[0_0_12px_rgba(34,197,94,0.15)]' : 'text-[#e8e8ec]/40 hover:text-[#e8e8ec]/70'}`}
                  >
                    <Folder size={16} strokeWidth={3} />
                    <span className="hidden lg:block font-sans font-black uppercase text-[9px] tracking-tight">Projects</span>
                  </button>
                  <button
                    onClick={() => setViewMode('agents')}
                    className={`flex items-center justify-center gap-1 p-2 rounded-lg transition-all ${viewMode === 'agents' ? 'bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/40 shadow-[0_0_12px_rgba(34,197,94,0.15)]' : 'text-[#e8e8ec]/40 hover:text-[#e8e8ec]/70'}`}
                  >
                    <Bot size={16} strokeWidth={3} />
                    <span className="hidden lg:block font-sans font-black uppercase text-[9px] tracking-tight">Agents</span>
                  </button>
                </div>
                </div>

                <AnimatePresence mode="wait">
                  {viewMode === 'session' && (
                    <motion.div
                      key="session-tools"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="space-y-1 pt-4"
                    >
                      <div className="flex items-center gap-3 p-3 hover:bg-black/5 transition-colors cursor-pointer group border-[3px] border-transparent hover:border-[#111]">
                        <Database size={18} className="text-[#111]" onClick={() => setShowVault(v => !v)} />
                        <span className="hidden lg:block font-sans font-black uppercase text-[11px] tracking-tight opacity-40 group-hover:opacity-100">Knowledge_Vault</span>
                      </div>
                      <div className="flex items-center gap-3 p-3 hover:bg-black/5 transition-colors cursor-pointer group border-[3px] border-transparent hover:border-[#111]">
                        <Zap size={18} className="text-[#111]" onClick={() => setShowSkills(v => !v)} />
                        <span className="hidden lg:block font-sans font-black uppercase text-[11px] tracking-tight opacity-40 group-hover:opacity-100">Skills_Module</span>
                      </div>
                      <div className="flex items-center gap-3 p-3 hover:bg-black/5 transition-colors cursor-pointer group border-[3px] border-transparent hover:border-[#111]">
                        <Brain size={18} className="text-[#111]" onClick={() => setShowMemory(v => !v)} />
                        <span className="hidden lg:block font-sans font-black uppercase text-[11px] tracking-tight opacity-40 group-hover:opacity-100">
                          Memory{contextVars.length > 0 && <span className="ml-1 text-[#22c55e]">({contextVars.length})</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 p-3 hover:bg-black/5 transition-colors cursor-pointer group border-[3px] border-transparent hover:border-[#111]">
                        <Globe size={18} className="text-[#111]" onClick={() => setShowWebhook(v => !v)} />
                        <span className="hidden lg:block font-sans font-black uppercase text-[11px] tracking-tight opacity-40 group-hover:opacity-100">Webhooks</span>
                      </div>
                      <div className="flex items-center gap-3 p-3 hover:bg-black/5 transition-colors cursor-pointer group border-[3px] border-transparent hover:border-[#111]">
                        <Cpu size={18} className="text-[#111]" onClick={() => setShowJobs(v => !v)} />
                        <span className="hidden lg:block font-sans font-black uppercase text-[11px] tracking-tight opacity-40 group-hover:opacity-100">Jobs_Pipeline</span>
                      </div>
                      <div className="flex items-center gap-3 p-3 hover:bg-black/5 transition-colors cursor-pointer group border-[3px] border-transparent hover:border-[#111]">
                        <Plug size={18} className="text-[#111]" onClick={() => setShowMCP(v => !v)} />
                        <span className="hidden lg:block font-sans font-black uppercase text-[11px] tracking-tight opacity-40 group-hover:opacity-100">MCP_Settings</span>
                      </div>
                    </motion.div>
                  )}
                  
                  {viewMode === 'agents' && (
                    <motion.div
                      key="agents-list"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="space-y-1 pt-4"
                    >
                      <p className="hidden lg:block font-mono text-[8px] font-black uppercase text-[#555] mb-2 px-2">Agent_Council</p>
                      {employees.map(emp => {
                        const isActive = emp.id === activeEmployee;
                        const isWorking = isActive && agentState !== 'default' && agentState !== 'job-done';
                        return (
                          <div key={emp.id} onClick={() => setActiveEmployee(emp.id)} className={`flex items-center gap-3 p-2 lg:p-3 border-[3px] cursor-pointer transition-all ${isActive ? 'bg-[#22c55e] border-[#111] shadow-[4px_4px_0_0_rgba(0,0,0,1)]' : 'border-transparent hover:border-[#111] hover:bg-black/5'}`}>
                            <div className="relative">
                              <span className={isActive ? 'text-[#111]' : 'text-[#111] opacity-50'}>{React.createElement(emp.icon, { size: 18 })}</span>
                              {/* Status indicator dot */}
                              <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-[#111] ${isWorking ? 'bg-[#22c55e] animate-pulse shadow-[0_0_6px_#22c55e]' : isActive ? 'bg-[#22c55e]' : 'bg-[#aaa]'}`} />
                            </div>
                            <div className="hidden lg:block flex-1"><p className="font-sans font-black uppercase text-[10px] mb-0.5">{emp.id}</p><p className="font-mono text-[7px] uppercase opacity-60">{emp.role}</p></div>
                            {isWorking && <div className="hidden lg:flex gap-0.5 items-center"><div className="w-1 h-1 bg-[#111] rounded-full animate-bounce [animation-delay:-0.2s]" /><div className="w-1 h-1 bg-[#111] rounded-full animate-bounce [animation-delay:-0.1s]" /><div className="w-1 h-1 bg-[#111] rounded-full animate-bounce" /></div>}
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                  {viewMode === 'projects' && activeProject && (
                    <motion.div
                      key="projects-workspace"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="space-y-3 pt-4"
                    >
                      {/* Active project header */}
                      <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-2">
                          <Folder size={14} className="text-[#22c55e]" />
                          <p className="hidden lg:block font-mono text-[8px] font-black uppercase text-[#555]">Active_Project</p>
                        </div>
                        <button onClick={() => setActiveProject(null)} className="p-1 hover:text-[#ef4444]" title="Close project">
                          <X size={12} />
                        </button>
                      </div>
                      <div className="border-[3px] border-[#111] bg-white p-3 shadow-[3px_3px_0_0_#111]">
                        <p className="font-sans font-black uppercase text-[11px]">{activeProject}</p>
                      </div>

                      {/* Project Todos */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between px-2">
                          <p className="hidden lg:block font-mono text-[7px] font-black uppercase text-[#888]">Tasks ({projectTodos.filter(t => !t.done).length})</p>
                          <button onClick={() => {
                            const text = prompt('New task:');
                            if (text && text.trim()) {
                              setProjectTodos(prev => [...prev, { id: Date.now().toString(36), text: text.trim(), done: false, createdAt: Date.now() }]);
                            }
                          }} className="p-1 hover:text-[#22c55e]"><Plus size={12} /></button>
                        </div>
                        {projectTodos.length === 0 && (
                          <p className="font-mono text-[7px] text-[#aaa] px-2">No tasks yet</p>
                        )}
                        {projectTodos.map(todo => (
                          <div key={todo.id} className="flex items-center gap-2 p-2 bg-white border-[2px] border-[#ddd] hover:border-[#111] cursor-pointer group transition-colors" onClick={() => setProjectTodos(prev => prev.map(t => t.id === todo.id ? { ...t, done: !t.done } : t))}>
                            <div className={`w-3 h-3 border-[2px] border-[#111] flex-shrink-0 flex items-center justify-center ${todo.done ? 'bg-[#22c55e]' : 'bg-white'}`}>
                              {todo.done && <Check size={10} strokeWidth={4} className="text-[#111]" />}
                            </div>
                            <span className={`font-sans text-[10px] flex-1 ${todo.done ? 'line-through text-[#aaa]' : 'text-[#111]'}`}>{todo.text}</span>
                            <button onClick={e => { e.stopPropagation(); setProjectTodos(prev => prev.filter(t => t.id !== todo.id)); }} className="opacity-0 group-hover:opacity-100 text-[#ef4444] hover:text-[#111] transition-opacity"><X size={10} /></button>
                          </div>
                        ))}
                      </div>

                      {/* File Browser */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between px-2">
                          <p className="hidden lg:block font-mono text-[7px] font-black uppercase text-[#888]">Files</p>
                          <div className="flex items-center gap-1">
                            {projectRoot && (
                              <span className="font-mono text-[6px] text-[#aaa] truncate max-w-[80px]" title={projectRoot}>{projectRoot.split('/').pop()}</span>
                            )}
                            <button onClick={() => {
                              const path = prompt('Project root folder path:', projectRoot || '/home/falcon/Apps/code');
                              if (path && path.trim()) {
                                setProjectRoot(path.trim());
                                setSelectedFile(null);
                              }
                            }} className="p-1 hover:text-[#22c55e]" title="Set root folder"><Folder size={10} /></button>
                          </div>
                        </div>
                        {projectRoot ? (
                          <div className="border-[2px] border-[#ddd] bg-white overflow-hidden">
                            <FileTree
                              rootPath={projectRoot}
                              onFileSelect={(path) => {
                                setSelectedFile(path);
                                setSplitView(true);
                                setPreviewFilePath(path);
                              }}
                              selectedFile={selectedFile}
                            />
                          </div>
                        ) : (
                          <div className="py-2 px-2 border-[2px] border-dashed border-[#ddd] text-center">
                            <p className="font-mono text-[7px] text-[#aaa]">Click folder icon to set project root</p>
                          </div>
                        )}
                      </div>

                      {/* Project Notes */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between px-2">
                          <p className="hidden lg:block font-mono text-[7px] font-black uppercase text-[#888]">Notes</p>
                        </div>
                        <textarea
                          value={projectNotes}
                          onChange={e => setProjectNotes(e.target.value)}
                          placeholder="Project notes... (markdown)"
                          className="w-full h-32 bg-white border-[2px] border-[#ddd] p-2 font-mono text-[9px] resize-none focus:outline-none focus:border-[#22c55e] leading-relaxed"
                        />
                      </div>
                    </motion.div>
                  )}
                  {viewMode === 'projects' && !activeProject && (
                    <motion.div
                      key="projects-grid"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="space-y-2 pt-4"
                    >
                      <div className="flex items-center justify-between px-2">
                        <p className="hidden lg:block font-mono text-[8px] font-black uppercase text-[#555]">Projects</p>
                        <button onClick={() => {
                          const name = prompt('Project name:');
                          if (name && name.trim()) {
                            const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
                            setProjects(prev => [...prev, { id: slug, name: name.trim(), description: '', createdAt: Date.now(), updatedAt: Date.now() }]);
                          }
                        }} className="p-1 hover:text-[#22c55e]"><Plus size={14} /></button>
                      </div>
                      {projects.length === 0 && (
                        <div className="text-center py-8 px-4">
                          <Folder size={24} className="mx-auto text-[#ddd] mb-2" />
                          <p className="font-mono text-[8px] uppercase text-[#aaa]">No projects yet</p>
                          <p className="font-mono text-[7px] text-[#ccc] mt-1">Create one to get started</p>
                        </div>
                      )}
                      {projects.map(proj => (
                        <div key={proj.id} onClick={() => setActiveProject(proj.name)} className="flex items-center gap-3 p-3 border-[3px] border-[#111] bg-white shadow-[3px_3px_0_0_#111] cursor-pointer hover:shadow-[5px_5px_0_0_#22c55e] transition-all group">
                          <Folder size={16} className="text-[#111] flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-sans font-black uppercase text-[10px] truncate">{proj.name}</p>
                            <p className="font-mono text-[7px] uppercase opacity-40">{formatRelativeTime(proj.updatedAt)}</p>
                          </div>
                          <button onClick={e => { e.stopPropagation(); setProjects(prev => prev.filter(p => p.id !== proj.id)); }} className="opacity-0 group-hover:opacity-100 text-[#ef4444] hover:text-[#111] transition-opacity"><Trash2 size={12} /></button>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              
              {/* ATM Mascot at bottom of sidebar */}
              <div className="w-full mt-auto pt-4 relative">
                <div className="w-full scale-90 lg:scale-[0.92] transform origin-bottom">
                  <AtmMascot state={agentState} />
                </div>
              </div>
            </aside>

            {/* ===== MAIN CONTENT AREA ===== */}
            <main className={`flex-1 flex overflow-hidden relative z-10 ${splitView ? 'flex-row' : 'flex-col'}`}>
              {/* Context bar */}
              <div className="flex-none flex items-center gap-3 px-4 py-2 bg-[#1c1c1e]/80 backdrop-blur-md border-b border-[#3a3a3e]">
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[7px] font-black uppercase text-[#555]">PROJECT</p>
                  <p className="font-mono text-[8px] text-[#e8e8ec]/70">{activeProject || 'DEFAULT'}</p>
                </div>
                <div className="w-px h-3 bg-[#3a3a3e]" />
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[7px] font-black uppercase text-[#555]">AGENT</p>
                  <p className="font-mono text-[8px] text-[#22c55e]">{config?.selectedAgent || 'PRAWN'}_V4</p>
                </div>
                <div className="w-px h-3 bg-[#3a3a3e]" />
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[7px] font-black uppercase text-[#555]">VARS</p>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[8px] text-[#e8e8ec]/70">{contextVars.length}</span>
                    {contextVars.length > 0 && (
                      <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse shadow-[0_0_6px_#22c55e]" />
                    )}
                  </div>
                </div>
                {projectNamespace && (
                  <>
                    <div className="w-px h-3 bg-[#3a3a3e]" />
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-[7px] font-black uppercase text-[#555]">NS</p>
                      <p className="font-mono text-[8px] text-[#e8e8ec]/50 truncate max-w-[100px]">{projectNamespace}</p>
                    </div>
                  </>
                )}
              </div>
              {/* Messages scroll area */}
              <section ref={scrollRef} className={`flex-1 overflow-hidden relative z-10 ${splitView ? 'w-1/2' : 'flex flex-col'} ${!splitView ? 'overflow-y-auto p-2 lg:p-4 space-y-2 scroll-smooth custom-scrollbar' : ''}`}>
                {/* Preview toggle — eye icon only */}
                <div className="flex items-center flex-none">
                  <div className="relative group">
                    <button
                      onClick={() => {
                        if (showPathInput) {
                          // Submit path
                          if (pathInputValue.trim()) {
                            setPreviewFilePath(pathInputValue.trim());
                            setSplitView(true);
                          }
                          setShowPathInput(false);
                          setPathInputValue('');
                        } else if (previewFilePath) {
                          // Already has path — toggle split view
                          setSplitView(v => !v);
                        } else {
                          // No path — show input
                          setShowPathInput(true);
                          setPathInputValue('');
                        }
                      }}
                      className={`p-1.5 transition-all ${splitView ? 'text-[#111] drop-shadow-[0_0_8px_rgba(34,197,94,0.9)]' : 'text-[#111] hover:text-[#111] hover:drop-shadow-[0_0_10px_rgba(34,197,94,0.95)]'}`}
                      title={splitView ? 'Exit Preview Mode' : 'Preview Mode'}
                    >
                      <Eye size={15} strokeWidth={2.5} />
                    </button>
                    {/* Tooltip */}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 bg-[#111] text-[#eae7de] font-mono text-[8px] font-black uppercase whitespace-nowrap border-[2px] border-[#111] shadow-[2px_2px_0_0_#22c55e] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50">
                      {splitView ? 'Exit Preview' : 'Preview File'}
                    </div>
                    {/* Path input — floating */}
                    {showPathInput && (
                      <div className="absolute top-full left-0 mt-1 bg-white border-[3px] border-[#111] shadow-[4px_4px_0_0_#111] p-2 z-50 w-64">
                        <p className="font-mono text-[7px] font-black uppercase text-[#888] mb-1.5">FILE_PATH_OR_URL</p>
                        <input
                          autoFocus
                          value={pathInputValue}
                          onChange={e => setPathInputValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              if (pathInputValue.trim()) {
                                setPreviewFilePath(pathInputValue.trim());
                                setSplitView(true);
                              }
                              setShowPathInput(false);
                              setPathInputValue('');
                            }
                            if (e.key === 'Escape') { setShowPathInput(false); setPathInputValue(''); }
                          }}
                          placeholder="src/App.jsx or http://..."
                          className="w-full bg-[#f5f5f0] border-[2px] border-[#111] px-2 py-1.5 font-mono text-[9px] focus:outline-none focus:border-[#22c55e]"
                        />
                        <p className="font-mono text-[7px] text-[#aaa] mt-1">Enter a file path or URL to preview</p>
                      </div>
                    )}
                  </div>
                  {/* File path indicator when previewing a file */}
                  {previewFilePath && splitView && (
                    <span className="ml-2 font-mono text-[7px] text-[#888] truncate max-w-[180px]" title={previewFilePath}>
                      {previewFilePath}
                    </span>
                  )}
                </div>
                {/* Messages list — scrollable when split view is on */}
                <div className={`${splitView ? 'flex-1 overflow-y-auto p-2 lg:p-4 space-y-2 scroll-smooth custom-scrollbar' : 'flex-1'}`}>
              <AnimatePresence initial={false}>
                {messages.filter(msg => msg.role !== 'assistant' || msg.content || (toolEventsByMsg[msg.id] && toolEventsByMsg[msg.id].length > 0) || agentThinking).map((msg, index, filteredArr) => (
                  <motion.div
                    key={msg.id + '-' + index}
                    initial={{ opacity: 0, y: 16, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    onMouseEnter={() => setHoveredMsgId(msg.id)}
                    onMouseLeave={() => setHoveredMsgId(null)}
                    className={`flex flex-col relative ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    {/* Hover action bar — only for assistant messages */}
                    {hoveredMsgId === msg.id && msg.role === 'assistant' && (
                      <div className="flex items-center gap-1 mb-1 px-2 py-1 bg-[#2a2a2e]/95 backdrop-blur-sm border-[1px] border-[#3a3a3e] shadow-[2px_2px_0_0_#3a3a3e]">
                        <button onClick={() => { setPreviewContent(msg.content); setSplitView(true); }} className="p-1 text-[#e8e8ec]/60 hover:text-[#22c55e] transition-colors" title="Preview">
                          <Eye size={10} />
                        </button>
                        <button onClick={() => handleCopyMessage(msg)} className="p-1 text-[#e8e8ec]/60 hover:text-[#22c55e] transition-colors" title="Copy">
                          {copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />}
                        </button>
                        <button onClick={() => { navigator.clipboard.writeText(msg.content); }} className="p-1 text-[#e8e8ec]/60 hover:text-[#22c55e] transition-colors" title="Save to Fabric">
                          <Save size={10} />
                        </button>
                        <button onClick={() => { setMessages(prev => prev.filter(m => m.id !== msg.id)); }} className="p-1 text-[#e8e8ec]/60 hover:text-[#ef4444] transition-colors" title="Delete">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    )}
                    {msg.role === 'user' && (
                      <div className={`flex items-center gap-2 mb-0.5 font-mono text-[9px] font-black uppercase tracking-[0.2em] flex-row-reverse text-[#3a3a3e]`}>
                        <User size={10} strokeWidth={3} />
                        USER_ID:SVR
                      </div>
                    )}
                    <div className={`max-w-[95%] lg:max-w-[80%] p-4 border-[2px] border-[#3a3a3e] shadow-[0_8px_32px_rgba(0,0,0,0.4)] ${msg.role === 'user' ? 'bg-[#e8e8ec]/85 text-[#111] rounded-[22px]' : 'bg-[#2a2a2e]/85 text-[#e8e8ec] backdrop-blur-sm relative'}`}>
                      {msg.role === 'assistant' && (
                        <div className="absolute -top-4 -left-4 -rotate-12 group z-50 cursor-help">
                          <Bot size={18} strokeWidth={2} className="text-[#22c55e] drop-shadow-[0_2px_8px_rgba(34,197,94,0.4)]" />
                          <div className="absolute bottom-full left-0 mb-2 px-2 py-1 bg-[#1c1c1e] border-[2px] border-[#3a3a3e] shadow-[2px_2px_0_0_#22c55e] opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 whitespace-nowrap z-[100] pointer-events-none">
                            <p className="font-mono text-[8px] font-black uppercase text-[#22c55e]">{msg.employee}_V4</p>
                          </div>
                        </div>
                      )}
                      {msg.content ? (
                        <div className={`prose prose-invert max-w-none ${msg.role === 'user' ? 'prose-neutral' : ''}`}>
                          <MessageMarkdown content={String(msg.content)} role={msg.role} />
                        </div>
                      ) : agentThinking && index === filteredArr.length - 1 ? (
                        <div className="flex items-center gap-2 text-[#888] py-2"><Activity size={14} className="animate-pulse" /> <span className="font-mono text-[10px] uppercase tracking-widest">Processing...</span></div>
                      ) : null}
                    </div>
                    {msg.role === 'assistant' && (
                      <div className="flex items-center gap-2 font-mono text-[9px] font-black uppercase tracking-[0.2em] text-[#22c55e] mt-0.5">
                        {msg.employee}_V4
                      </div>
                    )}
                    {/* Tool call cards — shown for assistant messages that have tool events */}
                    {msg.role === 'assistant' && toolEventsByMsg[msg.id]?.map((tool, idx) => {
                      const key = `${msg.id}-${idx}`;
                      const isOpen = expandedTools[key] || false;
                      const toolIcon = tool.tool === 'websearch' || tool.tool === 'search' ? <Search size={11} /> : tool.tool === 'code_exec' || tool.tool === 'code' ? <Terminal size={11} /> : <Zap size={11} />;
                      return (
                        <div key={key} className="mt-2 w-full max-w-[95%] lg:max-w-[80%]">
                          <button
                            onClick={() => setExpandedTools(prev => ({ ...prev, [key]: !prev[key] }))}
                            className="w-full flex items-center gap-2 px-3 py-2 bg-[#1c1c1e]/95 backdrop-blur-sm border-[2px] border-[#3a3a3e] shadow-[3px_3px_0_0_#3a3a3e] text-left hover:shadow-[3px_3px_0_0_#22c55e] transition-all"
                          >
                            <span className="text-[#22c55e]">{toolIcon}</span>
                            <span className="font-mono text-[9px] font-black uppercase text-[#22c55e] tracking-widest">TOOL: {tool.tool}</span>
                            <span className="font-mono text-[8px] uppercase text-[#888] ml-auto">{isOpen ? '▲ COLLAPSE' : '▼ EXPAND'}</span>
                          </button>
                          {isOpen && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="overflow-hidden bg-[#2a2a2e]/90 backdrop-blur-sm border-[2px] border-t-0 border-[#3a3a3e] shadow-[3px_3px_0_0_#3a3a3e]"
                            >
                              <div className="p-3 space-y-2">
                                {tool.input && (
                                  <div>
                                    <p className="font-mono text-[7px] font-black uppercase text-[#888] mb-1">INPUT</p>
                                    <pre className="font-mono text-[9px] text-[#e8e8ec] whitespace-pre-wrap break-all bg-[#1c1c1e] p-2 border-[2px] border-[#3a3a3e]">{typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)}</pre>
                                  </div>
                                )}
                                {tool.output && (
                                  <div>
                                    <p className="font-mono text-[7px] font-black uppercase text-[#888] mb-1">OUTPUT</p>
                                    <pre className="font-mono text-[9px] text-[#e8e8ec] whitespace-pre-wrap break-all bg-[#1c1c1e] p-2 border-[2px] border-[#3a3a3e]">{typeof tool.output === 'string' ? tool.output : JSON.stringify(tool.output, null, 2)}</pre>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </div>
                      );
                    })}
                  </motion.div>
                ))}
              </AnimatePresence>
              {agentState !== 'default' && agentState !== 'job-done' && (
                <div className="w-full flex flex-col items-center gap-2 py-6">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-bounce"></div>
                  </div>
                  <p className="font-mono text-[9px] font-black uppercase tracking-[0.2em] text-[#22c55e] animate-pulse">
                    {activeEmployee}_V4 — {agentState === 'processing' ? 'PARSING' : agentState === 'searching' ? 'SCRAPING_DB' : agentState === 'typing' ? 'SYNTHESIZING' : agentState === 'urgent' ? 'EXEC_OVERLOAD' : 'WORKING'}
                  </p>
                </div>
              )}
              </div>{/* end messages wrapper */}
              </section>
              {/* Input footer — always at bottom of chat side */}
              <footer className="flex-none p-4 lg:p-8">
              <form onSubmit={(e) => { unlock(); handleSend(e); }} className={`relative group transition-all ${isRecording ? 'shadow-[0_0_20px_rgba(34,197,94,0.4),0_0_40px_rgba(34,197,94,0.2),inset_0_0_20px_rgba(34,197,94,0.1)] border-[#22c55e]/60' : ''}`}>
                {/* REC Badge */}
                <AnimatePresence>
                  {isRecording && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="absolute -top-8 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 bg-[#1c1c1e] border-[1px] border-[#ef4444] rounded-full shadow-[2px_2px_0_0_#ef4444]"
                    >
                      <div className="w-2 h-2 bg-[#ef4444] rounded-full animate-pulse" />
                      <span className="font-mono text-[9px] font-black uppercase tracking-widest text-[#ef4444]">REC</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#22c55e]/60 z-10 pointer-events-none transition-opacity group-focus-within:opacity-100 opacity-70">
                  <Terminal size={18} strokeWidth={2.5} />
                </div>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Talk to your agent..."
                  className={`w-full bg-[#2a2a2e]/80 backdrop-blur-md border-[2px] border-[#3a3a3e] rounded-2xl py-5 lg:py-6 pl-14 pr-60 font-mono text-base lg:text-lg text-[#e8e8ec] placeholder:text-[#888] focus:outline-none transition-all shadow-[inset_0_0_0_1px_rgba(34,197,94,0.1),0_0_30px_rgba(34,197,94,0.05)] focus:border-[#22c55e]/60 focus:shadow-[inset_0_0_0_1px_rgba(34,197,94,0.3),0_0_40px_rgba(34,197,94,0.1)] ${isRecording ? 'border-[#22c55e]/60 animate-[pulse_1.5s_ease-in-out_infinite]' : ''}`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <WaveformIndicator agentState={agentState} isRecording={isRecording} />
                  <button
                    type="button"
                    onClick={() => setTtsEnabled(v => !v)}
                    aria-label={ttsEnabled ? 'Disable voice playback' : 'Enable voice playback'}
                    className={`grid place-items-center w-10 h-10 rounded-xl border-[1px] transition-all ${ttsEnabled ? 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30 hover:bg-[#22c55e]/20' : 'bg-[#3a3a3e]/50 text-[#888] border-[#3a3a3e] hover:bg-[#3a3a3e]/80'}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                      {ttsEnabled ? <path d="M15.5 8.5a5 5 0 0 1 0 7" /> : <path d="m16 8 4 8" />}
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={toggleRecording}
                    aria-label={isRecording ? 'Stop voice recording' : 'Start voice recording'}
                    className={`group grid place-items-center w-10 h-10 rounded-xl border-[1px] transition-all duration-300 ${isRecording ? 'bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/40 animate-[mic-pulse_1s_ease-in-out_infinite]' : 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30 hover:bg-[#22c55e]/20 hover:border-[#22c55e]/50 active:scale-95'}`}
                  >
                    {/* Animated mic SVG with sound wave bars on hover */}
                    <svg
                      viewBox="0 0 36 36"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className={`w-5 h-5 transition-all duration-300 ${isRecording ? 'animate-[sound-wave_0.6s_ease-in-out_infinite]' : 'group-hover:animate-[sound-wave_0.8s_ease-in-out_infinite]'}`}
                    >
                      {/* Mic body */}
                      <rect x="13" y="4" width="10" height="14" rx="5" fill="currentColor" opacity="0.9" />
                      {/* Mic stand arc */}
                      <path d="M9 14a9 9 0 0 0 18 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                      {/* Stand stem */}
                      <path d="M18 23v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      {/* Base */}
                      <path d="M13 31h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      {/* Left sound wave bars — visible on hover or recording */}
                      <rect x="3" y="10" width="2.5" height="6" rx="1.25" fill="currentColor" opacity="0" className={`${isRecording ? 'opacity-100' : 'group-hover:opacity-100'}`} />
                      <rect x="3" y="10" width="2.5" height="6" rx="1.25" fill="currentColor" opacity="0" className={`${isRecording ? 'opacity-100 animate-[bar-scale_0.6s_ease-in-out_infinite_0ms]' : 'group-hover:animate-[bar-scale_0.8s_ease-in-out_infinite_0ms]'}`} />
                      <rect x="7" y="8" width="2.5" height="10" rx="1.25" fill="currentColor" opacity="0" className={`${isRecording ? 'opacity-100 animate-[bar-scale_0.6s_ease-in-out_infinite_100ms]' : 'group-hover:animate-[bar-scale_0.8s_ease-in-out_infinite_100ms]'}`} />
                      {/* Right sound wave bars */}
                      <rect x="30.5" y="10" width="2.5" height="6" rx="1.25" fill="currentColor" opacity="0" className={`${isRecording ? 'opacity-100 animate-[bar-scale_0.6s_ease-in-out_infinite_0ms]' : 'group-hover:animate-[bar-scale_0.8s_ease-in-out_infinite_0ms]'}`} />
                      <rect x="26.5" y="8" width="2.5" height="10" rx="1.25" fill="currentColor" opacity="0" className={`${isRecording ? 'opacity-100 animate-[bar-scale_0.6s_ease-in-out_infinite_100ms]' : 'group-hover:animate-[bar-scale_0.8s_ease-in-out_infinite_100ms]'}`} />
                    </svg>
                  </button>
                  <button
                    type="submit"
                    disabled={!inputValue.trim() || agentState !== 'default'}
                    className={`flex items-center gap-2 px-6 py-3 font-sans font-black uppercase text-[10px] lg:text-xs rounded-xl border-[1px] transition-all ${!inputValue.trim() || agentState !== 'default' ? 'bg-[#3a3a3e]/50 text-[#888] border-[#3a3a3e] cursor-not-allowed' : 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30 hover:bg-[#22c55e]/20 hover:border-[#22c55e]/50 active:scale-95'}`}
                  >
                    Execute <Send size={13} strokeWidth={2.5} />
                  </button>
                </div>
                {voiceError && (
                  <p className="mt-2 px-1 font-mono text-[10px] text-[#ef4444]">{voiceError}</p>
                )}
              </form>
            </footer>
            {/* Split-view preview panel */}
              {splitView && (
                <PreviewPanel content={previewContent} filePath={previewFilePath} onClose={() => setSplitView(false)} />
              )}
          </main>
        </div>

        {/* ===== PANEL OVERLAYS ===== */}
        <AnimatePresence>
          {showSettings && (
            <SettingsPanel
              config={config}
              onSave={(newConfig) => { setConfig(newConfig); setShowSettings(false); }}
              onClose={() => setShowSettings(false)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showSkills && (
            <div className="fixed bottom-0 left-0 right-0 z-[150] p-3 bg-[#eae7de] border-t-[4px] border-[#111]">
              <SkillsHubPanel onClose={() => setShowSkills(false)} />
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showVault && (
            <div className="fixed bottom-0 left-0 right-0 z-[150] p-3 bg-[#eae7de] border-t-[4px] border-[#111]">
              <MemoryBrowserPanel onClose={() => setShowVault(false)} />
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showJobs && (
            <div className="fixed bottom-0 left-0 right-0 z-[150] p-3 bg-[#eae7de] border-t-[4px] border-[#111]">
              <JobsPipelinePanel onClose={() => setShowJobs(false)} />
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showMCP && (
            <MCPSettingsPanel onClose={() => setShowMCP(false)} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showMemory && (
            <div className="fixed bottom-0 left-0 right-0 z-[150] p-3 bg-[#eae7de] border-t-[4px] border-[#111]">
              <MemoryPanel
                namespace={projectNamespace}
                setNamespace={setProjectNamespace}
                vars={contextVars}
                setVars={setContextVars}
                onClose={() => setShowMemory(false)}
              />
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showWebhook && (
            <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
              <WebhookPanel onClose={() => setShowWebhook(false)} />
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showOnboarding && (
            <OnboardingWizard
              step={onboardingStep}
              onBack={() => setOnboardingStep(s => Math.max(0, s - 1))}
              onNext={() => setOnboardingStep(s => Math.min(ONBOARDING_STEPS.length - 1, s + 1))}
              onFinish={finishOnboarding}
            />
          )}
        </AnimatePresence>

        {/* ===== COMMAND PALETTE (Ctrl+K) ===== */}
        <AnimatePresence>
          {showCommandPalette && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
            >
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCommandPalette(false)} />
              {/* Palette */}
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                className="relative w-full max-w-lg mx-4 border-[3px] border-[#111] bg-[#eae7de] shadow-[8px_8px_0_0_#111]"
              >
                {/* Search input */}
                <div className="flex items-center gap-3 p-4 border-b-[3px] border-[#111]">
                  <Search size={16} className="text-[#111] opacity-50" />
                  <input
                    autoFocus
                    type="text"
                    value={cmdSearch}
                    onChange={e => setCmdSearch(e.target.value)}
                    placeholder="Type a command..."
                    className="flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-[#aaa]"
                  />
                  <kbd className="font-mono text-[9px] bg-[#111] text-[#eae7de] px-2 py-1 rounded">ESC</kbd>
                </div>
                {/* Command list */}
                <div className="max-h-[320px] overflow-y-auto p-2 space-y-1">
                  {filteredCommands.length === 0 ? (
                    <p className="font-mono text-xs text-center text-[#888] py-4">No commands found</p>
                  ) : filteredCommands.map((cmd, i) => (
                    <button
                      key={i}
                      onClick={cmd.action}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left font-mono text-xs hover:bg-[#111] hover:text-[#eae7de] transition-colors border-[2px] border-transparent hover:border-[#111]"
                    >
                      <span className="opacity-60">{cmd.icon}</span>
                      <span className="font-black uppercase tracking-wide">{cmd.label}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #111; border: 2px solid #eae7de; }
        @media (max-width: 1024px) { aside { width: 70px; } }
      `}</style>
    </div>
  );
}
