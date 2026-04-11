// ShareHandler.jsx — Handles incoming shared URLs/text from PWA share target
import React, { useEffect, useState } from 'react';

export default function ShareHandler({ onShared }) {
  const [shared, setShared] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const title = params.get('title');
    const text = params.get('text');
    const url = params.get('url');

    if (title || text || url) {
      const sharedData = { title, text, url };
      setShared(sharedData);
      // Notify parent to pre-fill input
      if (onShared) onShared(sharedData);
      // Clean the URL without reloading
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [onShared]);

  if (!shared) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] max-w-sm w-full px-4">
      <div className="bg-[#111] border border-[#22c55e]/30 text-[#eae7de] rounded-xl px-4 py-3 shadow-2xl flex items-start gap-3">
        <span className="text-[#22c55e] text-xs font-mono font-black uppercase mt-0.5 shrink-0">SHARED</span>
        <div className="flex-1 min-w-0">
          {shared.text && (
            <p className="text-[11px] leading-relaxed truncate">{shared.text}</p>
          )}
          {shared.url && (
            <p className="text-[10px] text-[#22c55e]/60 font-mono truncate mt-0.5">{shared.url}</p>
          )}
        </div>
        <button
          onClick={() => setShared(null)}
          className="text-[#eae7de]/40 hover:text-[#eae7de] transition-colors shrink-0"
          aria-label="Dismiss shared content"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
