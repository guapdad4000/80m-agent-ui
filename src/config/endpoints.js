const ENDPOINTS_KEY = '80m-endpoint-config';

const DEFAULT_ENDPOINTS = {
  hermesBase: 'http://localhost:5174',
  localApiBase: 'http://localhost:5175',
  webhookBase: 'http://localhost:5176',
};

export const getEndpointConfig = () => {
  try {
    const raw = localStorage.getItem(ENDPOINTS_KEY);
    if (!raw) return DEFAULT_ENDPOINTS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_ENDPOINTS,
      ...parsed,
    };
  } catch {
    return DEFAULT_ENDPOINTS;
  }
};

export const setEndpointConfig = (nextConfig) => {
  const merged = { ...DEFAULT_ENDPOINTS, ...(nextConfig || {}) };
  localStorage.setItem(ENDPOINTS_KEY, JSON.stringify(merged));
  return merged;
};

export const getHermesBase = () => getEndpointConfig().hermesBase;
export const getLocalApiBase = () => getEndpointConfig().localApiBase;
export const getWebhookBase = () => getEndpointConfig().webhookBase;
