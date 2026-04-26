# 80m Agent Control — Mission Control Interface

**Sovereign Agent Council** — a free, installable PWA chat interface for your Hermes/OpenClaw agents.

Give this to clients when you deploy an agent. They extract the zip, run `npm install && npm run dev`, configure their API endpoint, and they have a branded mission control.

---

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`

To build for production:

```bash
npm run build
npm run preview
```

Run a full local smoke check (lint + production build):

```bash
npm run smoke
```

---

## PWA Install (Native App)

1. `npm run build`
2. Serve the `dist/` folder (any static server works)
3. In Chrome/Edge: click the install banner or use address bar icon
4. Works offline — the shell is cached, real API calls require connection

To generate icons (optional, already included):

```bash
npm run generate-icons
```

---

## Configuration

Click the **Settings** button (top-right gear) to configure:

### Connection Tab
- **API Endpoint**: Your agent's chat API (e.g. `http://localhost:5174/chat`)
- Leave empty or disable API to run in **Demo Mode** (simulated responses)
- **Welcome Message**: Customise the opening greeting
- If you save a new **Hermes base URL**, the app now auto-updates chat routing/connectivity checks immediately (no reload required)

### Agents Tab
- Add/remove/reorder agents in the council
- Each agent has: name, role, accent color
- Config is saved to localStorage and can be **exported/imported as JSON**

### Config Tab
- **Export** your full config to share with clients
- **Import** a client's config to clone a setup
- **Reset All** to wipe localStorage and start fresh

---

## Demo Mode

When no API is configured, the app runs in Demo Mode:
- Messages are simulated with the original animated responses
- All UI features are fully functional
- Useful for presenting/showing the interface without a live backend

---

## Structure

```
80m-agent-ui/
├── public/
│   ├── favicon.svg
│   ├── pwa-192x192.png
│   ├── pwa-512x512.png
│   └── apple-touch-icon.png
├── src/
│   ├── main.jsx       — entry point
│   ├── App.jsx        — full app (UI + logic)
│   └── index.css      — global styles + Tailwind
├── scripts/
│   └── generate-icons.js
├── index.html
├── vite.config.js     — Vite + PWA config
├── tailwind.config.js
└── package.json
```

---

## For Deployment

Build the static files:

```bash
npm run build
```

Serve `dist/` from any static host (Netlify, Vercel, Cloudflare Pages, nginx, etc.)

The PWA manifest and service worker are generated automatically.

---

## Mobile Access from Anywhere with Tailscale

If your goal is: “install this PWA on phone/iPad and connect from anywhere,” this repo already includes a helper script: `deploy-tailscale.sh`.

### Option A (recommended): private access over your Tailnet

Best when only you/team should access the UI.

1. On the host machine, install and log into Tailscale.
2. Build + serve the app:

```bash
./deploy-tailscale.sh --serve-only
```

3. On your iPhone/iPad, install the **Tailscale** app and sign into the same tailnet.
4. In Tailscale admin, note your host MagicDNS name (something like `hostname.tailnet.ts.net`).
5. Open on mobile:

```text
http://<your-magicdns-name>:5190
```

6. In Safari, use **Share → Add to Home Screen** to install as an app.

### Option B: public URL using Tailscale Funnel

Use this when you truly need internet-reachable access without joining your tailnet.

```bash
./deploy-tailscale.sh --funnel
```

The script enables Funnel on port `5190` and prints the HTTPS URL. Open that URL on mobile and install to home screen.

### Practical notes

- Keep your API endpoint in app Settings pointed at a URL reachable from mobile (tailnet URL, Funnel URL, or public backend).
- If your backend is private, expose backend and UI consistently (both on tailnet, or both public with auth).
- Funnel is public internet exposure; add auth/rate limits at your backend before sharing widely.

---

## Custom Branding

To rebrand for a different agent/business:

1. Update `DEFAULT_CONFIG` in `App.jsx` (welcome message, default agents)
2. Replace `favicon.svg` and regenerate icons
3. Change `80m` text to your brand name throughout App.jsx
4. Update the PWA `name` and `short_name` in `vite.config.js`

The interface is a template — the mascot, colors, and fonts stay consistent but the branding is yours.
