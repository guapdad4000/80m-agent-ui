// useOffline.js — Tracks online/offline status and Hermes connectivity
import { useState, useEffect, useCallback, useRef } from 'react';
import { getQueue } from '../offlineQueue';
import { getHermesBase } from '../config/endpoints';

const PING_INTERVAL_MS = 10000; // ping Hermes every 10s

export default function useOffline() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isHermesConnected, setIsHermesConnected] = useState(false);
  const [queueCount, setQueueCount] = useState(() => getQueue().length);
  const pingIntervalRef = useRef(null);

  // Track browser online/offline
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => {
      setIsOnline(false);
      setIsHermesConnected(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Ping Hermes to check connectivity — use /sessions which always returns 200
  const pingHermes = useCallback(async () => {
    const hermesBase = getHermesBase();
    if (!navigator.onLine) {
      setIsHermesConnected(false);
      return;
    }
    try {
      const res = await fetch(`${hermesBase}/sessions`, {
        signal: AbortSignal.timeout(4000),
      });
      setIsHermesConnected(res.ok);
    } catch {
      setIsHermesConnected(false);
    }
  }, []);

  // Start ping loop
  useEffect(() => {
    pingHermes(); // immediate first ping
    pingIntervalRef.current = setInterval(pingHermes, PING_INTERVAL_MS);
    return () => clearInterval(pingIntervalRef.current);
  }, [pingHermes]);

  // Refresh queue count whenever storage changes
  useEffect(() => {
    const syncQueueCount = () => setQueueCount(getQueue().length);
    window.addEventListener('storage', syncQueueCount);
    // Also poll every 5s for local changes
    const interval = setInterval(syncQueueCount, 5000);
    return () => {
      window.removeEventListener('storage', syncQueueCount);
      clearInterval(interval);
    };
  }, []);

  // Manual reconnect — force a ping
  const reconnect = useCallback(() => {
    pingHermes();
  }, [pingHermes]);

  return {
    isOnline,
    isHermesConnected,
    queueCount,
    reconnect,
  };
}
