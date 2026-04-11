// offlineQueue.js — Offline message queue for 80m-agent-ui
// Uses localStorage to persist queued messages when Hermes is unreachable

const QUEUE_KEY = '80m-offline-queue';

const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

/**
 * Add a message to the offline queue.
 * @param {Object} msg - { text: string, agent?: string }
 * @returns {string} the queued item id
 */
export const queueMessage = (msg) => {
  const queue = getQueue();
  const item = {
    id: generateId(),
    text: msg.text,
    agent: msg.agent || 'prawnius',
    timestamp: Date.now(),
    status: 'queued', // 'queued' | 'sending' | 'sent' | 'failed'
  };
  queue.push(item);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return item.id;
};

/**
 * Get all queued messages.
 * @returns {Array}
 */
export const getQueue = () => {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

/**
 * Remove a message from the queue by id.
 * @param {string} id
 */
export const removeFromQueue = (id) => {
  const queue = getQueue().filter(item => item.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
};

/**
 * Clear the entire queue.
 */
export const clearQueue = () => {
  localStorage.setItem(QUEUE_KEY, JSON.stringify([]));
};

/**
 * Process all queued messages by sending them to Hermes.
 * On success, removes the message from the queue.
 * On failure, leaves it in the queue for retry.
 * @param {Function} sendFn - async (text, agent) => response
 * @returns {Promise<Array>} results of each send attempt
 */
export const processQueue = async (sendFn) => {
  const queue = getQueue();
  const results = [];

  for (const item of queue) {
    // Mark as sending
    updateQueueItem(item.id, { status: 'sending' });
    try {
      const result = await sendFn(item.text, item.agent);
      // Success — remove from queue
      removeFromQueue(item.id);
      results.push({ id: item.id, success: true, result });
    } catch (err) {
      // Failed — leave in queue with failed status
      updateQueueItem(item.id, { status: 'failed', error: err.message });
      results.push({ id: item.id, success: false, error: err.message });
    }
  }

  return results;
};

/**
 * Update a single queue item in place.
 */
const updateQueueItem = (id, updates) => {
  const queue = getQueue().map(item =>
    item.id === id ? { ...item, ...updates } : item
  );
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
};

/**
 * Subscribe to online events and process queue automatically.
 * Call this once at app startup.
 * @param {Function} sendFn
 */
export const initQueueAutoProcess = (sendFn) => {
  window.addEventListener('online', () => {
    // Small delay to ensure connection is stable
    setTimeout(() => processQueue(sendFn), 2000);
  });
};
