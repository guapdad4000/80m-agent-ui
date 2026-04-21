import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import './index.css';

const detectDesktopShell = () => {
  if (typeof window === 'undefined') return false;
  const ua = String(window.navigator?.userAgent || '');
  const hasElectronUa = /Electron/i.test(ua);
  const hasNativefierUa = /Nativefier/i.test(ua);
  const hasElectronProcess = Boolean(window.process?.versions?.electron);
  const hasNativefierBridge = Boolean(window.nativefier || window.Nativefier || window.__nativefier);
  return hasElectronUa || hasNativefierUa || hasElectronProcess || hasNativefierBridge;
};

const disableServiceWorkers = async () => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
    if (regs.length) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.warn('Failed to disable service workers in desktop shell:', err);
  }
};

const isDesktopShell = detectDesktopShell();
if (isDesktopShell) {
  disableServiceWorkers();
} else {
  registerSW({ immediate: true });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
