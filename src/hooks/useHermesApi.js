// useHermesApi.js — Offline-aware wrapper for all Hermes API calls
import { useState, useCallback, useRef } from 'react';
import { queueMessage, processQueue } from '../offlineQueue';
import { isOpenAICompatibleEndpoint, buildApiPayload, extractAssistantText } from '../lib/chatTransport';
import { getHermesBase } from '../config/endpoints';

const HERMES_BASE = getHermesBase();
const HERMES_URL = HERMES_BASE;
const POLL_INTERVAL_MS = 2000;

export default function useHermesApi() {
  const [isConnected, setIsConnected] = useState(false);

  // Check connectivity — use /sessions which always returns 200
  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch(`${HERMES_BASE}/sessions`, {
        signal: AbortSignal.timeout(4000),
      });
      setIsConnected(res.ok);
      return res.ok;
    } catch {
      setIsConnected(false);
      return false;
    }
  }, []);

  /**
   * Poll a job status until completed or failed.
   * @param {string} jobId
   * @returns {Promise<Object>} final statusData
   */
  const pollJobStatus = useCallback(async (jobId) => {
    const base = HERMES_URL;
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const res = await fetch(`${base}/chat/status/${jobId}`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) continue;
        const data = await res.json();

        if (data.status === 'queued' || data.status === 'running') continue;
        if (data.status === 'completed') return data;
        if (data.status === 'failed') throw new Error(data.result?.error || data.error || 'Job failed');
      } catch (err) {
        if (err.name === 'AbortError') continue;
        throw err;
      }
    }
    throw new Error('Job polling timeout');
  }, []);

  /**
   * Send a message to Hermes. Falls back to offline queue if unreachable.
   * @param {string} text
   * @param {string} agentId
   * @returns {Promise<{queued: boolean, jobId?: string, response?: string}>}
   */
  const sendMessage = useCallback(async (text, agentId) => {
    const connected = await checkConnection();

    if (!connected) {
      // Queue for later
      const id = queueMessage({ text, agent: agentId });
      return { queued: true, queueId: id };
    }

    // Submit the job
    const endpoint = isOpenAICompatibleEndpoint(HERMES_URL) ? HERMES_URL : `${HERMES_URL}/chat`;
    const payload = buildApiPayload({ endpoint, message: text, agentId });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobId = data.job_id;

    if (jobId) {
      // Poll until done
      const statusData = await pollJobStatus(jobId);
      // Hermes agent-chat-service returns: { response: "...", events: [...] }
      const responseText = statusData.response || statusData.result?.response || '';
      const events = statusData.events || statusData.result?.events || [];
      return { queued: false, jobId, response: responseText, events };
    }

    const responseText = extractAssistantText(data);
    if (!responseText) throw new Error('Missing response payload from endpoint');
    return { queued: false, response: responseText, events: [] };
  }, [checkConnection, pollJobStatus]);

  /**
   * List a filesystem path via Hermes.
   * @param {string} path
   * @returns {Promise<Object>} JSON response
   */
  const fetchFsList = useCallback(async (path) => {
    const res = await fetch(`${HERMES_URL}/fs/list?path=${encodeURIComponent(path)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, []);

  /**
   * Read a file via Hermes.
   * @param {string} path
   * @returns {Promise<string>} file content
   */
  const fetchFsRead = useCallback(async (path) => {
    const res = await fetch(`${HERMES_URL}/fs/read?path=${encodeURIComponent(path)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }, []);

  /**
   * Process all queued offline messages.
   * Returns array of results.
   */
  const flushQueue = useCallback(async () => {
    return processQueue(async (text, agentId) => {
      const result = await sendMessage(text, agentId);
      return result;
    });
  }, [sendMessage]);

  return {
    sendMessage,
    pollJobStatus,
    fetchFsList,
    fetchFsRead,
    checkConnection,
    isConnected,
    flushQueue,
  };
}
