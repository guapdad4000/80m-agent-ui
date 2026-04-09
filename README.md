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

## Custom Branding

To rebrand for a different agent/business:

1. Update `DEFAULT_CONFIG` in `App.jsx` (welcome message, default agents)
2. Replace `favicon.svg` and regenerate icons
3. Change `80m` text to your brand name throughout App.jsx
4. Update the PWA `name` and `short_name` in `vite.config.js`

The interface is a template — the mascot, colors, and fonts stay consistent but the branding is yours.
