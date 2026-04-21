/**
 * Local FS API Server for 80m-agent-ui
 * Serves on port 5175 — handles /fs/list, /fs/read, /fs/raw
 * 
 * Run: node server-fs-api.cjs
 * Auto-starts alongside 80m-agent-ui dev server
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 5183;
const HOME = process.env.HOME || '/home/falcon';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

function serveFsList(reqPath) {
  const rawPath = decodeURIComponent(reqPath || '/');
  // Resolve relative to HOME, disallow traversal above HOME
  const targetPath = path.normalize(path.join(HOME, rawPath));
  if (!targetPath.startsWith(HOME)) {
    return { status: 403, body: { error: 'Forbidden: path outside home' } };
  }
  if (!fs.existsSync(targetPath)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return { status: 400, body: { error: 'Not a directory' } };
  }
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  const files = entries.map(entry => {
    const fullPath = path.join(targetPath, entry.name);
    let mtime;
    try {
      mtime = fs.statSync(fullPath).mtime.toISOString();
    } catch {}
    return {
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : 'file',
      mtime,
      size: entry.isFile() ? fs.statSync(fullPath).size : undefined,
    };
  });
  return { status: 200, body: { files }, contentType: 'application/json' };
}

function serveFsRead(reqPath) {
  const rawPath = decodeURIComponent(reqPath || '');
  const targetPath = path.normalize(path.join(HOME, rawPath));
  if (!targetPath.startsWith(HOME)) {
    return { status: 403, body: 'Forbidden: path outside home' };
  }
  if (!fs.existsSync(targetPath)) {
    return { status: 404, body: 'Not found' };
  }
  if (fs.statSync(targetPath).isDirectory()) {
    return { status: 400, body: 'Is a directory' };
  }
  try {
    const content = fs.readFileSync(targetPath, 'utf8');
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'text/plain';
    return { status: 200, body: content, contentType };
  } catch (e) {
    return { status: 500, body: `Error reading file: ${e.message}` };
  }
}

function serveFsRaw(reqPath) {
  const rawPath = decodeURIComponent(reqPath || '');
  const targetPath = path.normalize(path.join(HOME, rawPath));
  if (!targetPath.startsWith(HOME)) {
    return { status: 403 };
  }
  if (!fs.existsSync(targetPath)) {
    return { status: 404 };
  }
  if (fs.statSync(targetPath).isDirectory()) {
    return { status: 400 };
  }
  try {
    const content = fs.readFileSync(targetPath);
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    return { status: 200, body: content, contentType, raw: true };
  } catch (e) {
    return { status: 500 };
  }
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // FS endpoints
  if (pathname === '/fs/list') {
    const result = serveFsList(parsed.query.path);
    res.writeHead(result.status, { 'Content-Type': result.contentType || 'application/json' });
    const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    res.end(body);
    return;
  }

  if (pathname === '/fs/read') {
    const result = serveFsRead(parsed.query.path);
    res.writeHead(result.status, { 'Content-Type': result.contentType || 'text/plain' });
    const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    res.end(body);
    return;
  }

  if (pathname === '/fs/raw') {
    const result = serveFsRaw(parsed.query.path);
    res.writeHead(result.status, { 'Content-Type': result.contentType || 'application/octet-stream' });
    if (Buffer.isBuffer(result.body)) {
      res.end(result.body);
    } else {
      res.end(String(result.body));
    }
    return;
  }

  // Skills — serve from ~/.hermes/skills as { files: [...] }
  if (pathname === '/skills' || pathname === '/skills/list') {
    const skillsPath = path.join(HOME, '.hermes', 'skills');
    if (!fs.existsSync(skillsPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files: [] }));
      return;
    }
    const entries = fs.readdirSync(skillsPath, { withFileTypes: true });
    const files = entries.filter(e => e.isDirectory()).map(e => ({
      name: e.name,
      type: 'dir',
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ files }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', available: ['/health', '/fs/list', '/fs/read', '/fs/raw', '/skills'] }));
});

server.listen(PORT, () => {
  console.log(`[fs-api] Local FS API running on http://localhost:${PORT}`);
  console.log(`[fs-api] Serving files relative to: ${HOME}`);
  console.log(`[fs-api] Endpoints: /fs/list, /fs/read, /fs/raw, /skills, /health`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
