const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const app = express();
const PORT = 3000;
const ROOT = __dirname;
const SERVICES_DIR = path.join(ROOT, 'services');

let daemonProcess = null;
let demoProcess = null;
let logs = [];

function addLog(message) {
    const entry = {
        time: new Date().toLocaleTimeString(),
        message: String(message).trimEnd()
    };
    logs.push(entry);
    if (logs.length > 250) logs = logs.slice(-250);
    console.log(`[${entry.time}] ${entry.message}`);
}

function readServices() {
    try {
        return fs.readdirSync(SERVICES_DIR)
            .filter(file => file.endsWith('.service'))
            .sort()
            .map(file => ({
                file,
                content: fs.readFileSync(path.join(SERVICES_DIR, file), 'utf8')
            }));
    } catch (error) {
        return [];
    }
}

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MiniSystemd | Control Center</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#121a2d;--line:#26334c;--text:#e9efff;--muted:#8c9bb8;--blue:#70a5ff;--green:#4cdb9b;--orange:#ffbd69}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(ellipse at top,#172749 0%,var(--bg) 48%);color:var(--text);font:15px system-ui,Segoe UI,sans-serif;min-height:100vh}
header{padding:28px 5%;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.brand{display:flex;gap:14px;align-items:center}.logo{width:45px;height:45px;border-radius:13px;background:#233d70;display:grid;place-items:center;font-size:24px}
h1{font-size:23px;margin:0}.sub{color:var(--muted);margin-top:4px;font-size:13px}
main{max-width:1400px;margin:auto;padding:26px 5% 45px}
.actions{display:flex;gap:10px;flex-wrap:wrap}
button{border:1px solid var(--line);background:#1a2741;color:var(--text);border-radius:9px;padding:11px 16px;font-weight:650;cursor:pointer}
button:hover{filter:brightness(1.2)}button.primary{background:#326ee5;border-color:#528bff}button:disabled{opacity:.55;cursor:wait}
.notice{margin:18px 0;padding:13px 16px;border:1px solid #354866;border-radius:10px;color:#b9c9e8;background:#111d32;font-size:13px}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;margin:20px 0}
.card,.panel{background:linear-gradient(145deg,#151f34,#101728);border:1px solid var(--line);border-radius:14px;padding:20px;min-width:0}
.stat-label{font-size:13px;color:var(--muted)}.stat-value{font-size:27px;font-weight:750;margin-top:8px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:18px}
.panel h2{font-size:16px;margin:0 0 17px}.service{border:1px solid var(--line);background:#10182a;padding:14px;border-radius:10px;margin:10px 0}
.service-title{font-weight:700;overflow-wrap:anywhere}.file{font-size:12px;color:var(--muted);margin-top:4px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:190px;overflow:auto;background:#090e18;padding:12px;border-radius:8px;color:#a9caff;font-size:12px}
#logs{height:355px;max-height:55vh;overflow:auto;background:#070b12;border:1px solid #1c2b40;border-radius:10px;padding:13px;font:12px/1.8 ui-monospace,Consolas,monospace}
.logline{white-space:pre-wrap;overflow-wrap:anywhere;border-bottom:1px solid #172135;padding:4px 0}.time{color:#7185a8;margin-right:8px}.empty{color:var(--muted);padding:18px 0}
footer{color:var(--muted);font-size:12px;margin-top:22px}
@media(max-width:800px){.grid{grid-template-columns:1fr}.stats{grid-template-columns:1fr}.stat-value{font-size:23px}}
</style>
</head>
<body>
<header>
  <div class="brand"><div class="logo">⚡</div><div><h1>MiniSystemd</h1><div class="sub">Linux service supervision · C backend · Express control plane</div></div></div>
  <div class="actions">
    <button class="primary" id="boot" onclick="bootDaemon()">▶ Boot daemon</button>
    <button onclick="checkStatus()">↻ Check status</button>
    <button onclick="loadServices()">Refresh units</button>
  </div>
</header>
<main>
  <div class="notice">Feature 5 enabled: view live service states and start loaded services through the minictl Unix socket control plane.</div>
  <section class="panel" style="margin-bottom:18px">
    <h2>🧪 Feature Demonstrations</h2>
    <p style="color:var(--muted);font-size:13px">Run each test separately. Original service files are restored after each test.</p>
    <div class="actions">
      <button class="primary demo-button" onclick="runDemo('reaping', this)">Test Process Reaping</button>
      <button class="demo-button" onclick="runDemo('dependency', this)">Test Dependency Ordering</button>
      <button class="demo-button" onclick="runDemo('circular', this)">Test Circular Dependency</button>
      <button class="demo-button" onclick="runDemo('restart', this)">Test Automatic Restart</button>
    </div>
  </section>
  <section class="stats">
    <div class="card"><div class="stat-label">DAEMON CONNECTION</div><div class="stat-value" id="daemonState">Checking…</div></div>
    <div class="card"><div class="stat-label">UNIT FILES DISCOVERED</div><div class="stat-value" id="unitCount">—</div></div>
    <div class="card"><div class="stat-label">LATEST ACTIVE COUNT</div><div class="stat-value" id="activeCount">—</div></div>
  </section>
  <section class="panel" style="margin:18px 0">
    <h2>🎛️ Service Control Center</h2>
    <p style="color:var(--muted);font-size:13px">Live states come from the running C daemon. Start requests use minictl.</p>
    <div id="serviceMessage" class="empty">Checking service status…</div>
    <div id="serviceControls"></div>
  </section>
  <section class="panel" style="margin:18px 0">
    <h2>📊 Live Resource Monitoring</h2>
    <p style="color:var(--muted);font-size:13px">CPU and resident RAM readings for supervised services.</p>
    <div id="resourceMessage" class="empty">Loading resource readings…</div>
    <div id="resourceControls" class="grid"></div>
    <div class="grid" style="margin-top:18px">
  <div class="card">
    <h3>CPU Usage (%)</h3>
    <canvas id="cpuGraph" height="150" style="width:100%;display:block"></canvas>
  </div>
  <div class="card">
    <h3>RAM Usage (MB)</h3>
    <canvas id="ramGraph" height="150" style="width:100%;display:block"></canvas>
  </div>
</div>
  </section>
  <section class="grid">
    <div class="panel">
      <h2>▤ Service unit files</h2>
      <div id="services"><div class="empty">Loading service definitions…</div></div>
    </div>
    <div class="panel">
      <h2>▣ Daemon execution log</h2>
      <div class="actions" style="margin-bottom:12px">
        <button onclick="loadLogs()">Refresh logs</button>
        <button onclick="clearLogs()">Clear display</button>
      </div>
      <div id="logs"><div class="empty">Waiting for daemon output. Click “Boot daemon” to start your C program.</div></div>
    </div>
  </section>
  <footer>MiniSystemd local control plane · Data comes from the local project and minictl IPC response.</footer>
</main>
<script>
let displayCleared = false;

async function api(url, options) {
  const response = await fetch(url, options || {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function runDemo(feature, button) {
  const buttons = [...document.querySelectorAll('.demo-button')];
  buttons.forEach(b => b.disabled = true);
  const originalText = button.textContent;
  button.textContent = 'Running…';
  try {
    const data = await api('/api/demo', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({feature})
    });
    displayCleared = false;
    await loadLogs();
    if (data.message) console.log(data.message);
  } catch (error) {
    alert('Could not run demo: ' + error.message);
  } finally {
    button.textContent = originalText;
    buttons.forEach(b => b.disabled = false);
    await loadLogs();
    await checkStatus();
  }
}

async function loadServices() {
  const target = document.getElementById('services');
  try {
    const data = await api('/api/services');
    document.getElementById('unitCount').textContent = data.services.length;
    target.replaceChildren();
    if (!data.services.length) {
      target.innerHTML = '<div class="empty">No .service files found in services/.</div>';
      return;
    }
    for (const service of data.services) {
      const card = document.createElement('div');
      card.className = 'service';
      const title = document.createElement('div');
      title.className = 'service-title';
      title.textContent = service.file;
      const file = document.createElement('div');
      file.className = 'file';
      file.textContent = 'Actual file: services/' + service.file;
      const pre = document.createElement('pre');
      pre.textContent = service.content;
      card.append(title, file, pre);
      target.appendChild(card);
    }
  } catch (error) {
    target.textContent = 'Could not load service files: ' + error.message;
  }
}

async function checkStatus() {
  try {
    const data = await api('/api/status');
    document.getElementById('daemonState').textContent =
      data.running ? 'Connected' : 'Not running';
    document.getElementById('activeCount').textContent =
      data.activeCount === null ? 'Unavailable' : data.activeCount;

    renderServiceControls(data.services || [], data.running);
    if (!data.running) {
      document.getElementById('serviceMessage').textContent =
        data.message || 'Daemon not responding. Start the daemon before controlling services.';
    } else {
      document.getElementById('serviceMessage').textContent =
        'Daemon connected. Use Start service to launch a stopped service.';
    }
  } catch (error) {
    document.getElementById('daemonState').textContent = 'Unavailable';
    document.getElementById('activeCount').textContent = '—';
    document.getElementById('serviceMessage').textContent =
      'Could not read service status: ' + error.message;
  }
}

function renderServiceControls(services, daemonRunning) {
  const target = document.getElementById('serviceControls');
  target.replaceChildren();

  if (!services.length) {
    target.textContent = 'No service status data received yet.';
    return;
  }

  for (const service of services) {
    const card = document.createElement('div');
    card.className = 'service';

    const title = document.createElement('div');
    title.className = 'service-title';
    title.textContent = service.name;

    const state = document.createElement('div');
    state.className = 'file';
    state.textContent = service.state +
      (service.pid ? ' · PID ' + service.pid : '');

    const button = document.createElement('button');
    button.textContent = service.state === 'RUNNING' ? 'Already running' : '▶ Start service';
    button.disabled = !daemonRunning || service.state === 'RUNNING';
    button.addEventListener('click', () => startService(service.name, button));

    card.append(title, state, button);
    target.appendChild(card);
  }
}

async function startService(name, button) {
  const message = document.getElementById('serviceMessage');
  button.disabled = true;
  button.textContent = 'Starting…';

  try {
    const data = await api('/api/service/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name})
    });
    message.textContent = data.message || 'Start request completed.';
    await checkStatus();
    await loadLogs();
  } catch (error) {
    message.textContent = 'Start failed: ' + error.message;
    await checkStatus();
  } finally {
    button.disabled = false;
    button.textContent = '▶ Start service';
  }
}

async function bootDaemon() {
  const button = document.getElementById('boot');
  button.disabled = true;
  button.textContent = 'Starting…';
  try {
    const data = await api('/api/run', {method:'POST'});
    if (data.message) console.log(data.message);
    await loadLogs();
    await checkStatus();
  } catch (error) {
    alert('Could not start MiniSystemd: ' + error.message);
  } finally {
    button.disabled = false;
    button.textContent = '▶ Boot daemon';
  }
}

async function loadLogs() {
  if (displayCleared) return;
  try {
    const data = await api('/api/logs');
    const box = document.getElementById('logs');
    box.replaceChildren();
    if (!data.logs.length) {
      box.innerHTML = '<div class="empty">No output captured yet.</div>';
      return;
    }
    for (const entry of data.logs) {
      const line = document.createElement('div');
      line.className = 'logline';
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = '[' + entry.time + ']';
      const message = document.createElement('span');
      message.textContent = entry.message;
      line.append(time, message);
      box.appendChild(line);
    }
    box.scrollTop = box.scrollHeight;
  } catch (error) {}
}

function clearLogs() {
  displayCleared = true;
  document.getElementById('logs').innerHTML = '<div class="empty">Log display cleared. Capturing continues on the server.</div>';
  setTimeout(() => { displayCleared = false; loadLogs(); }, 5000);
}

const resourceHistory = { cpu: [], ram: [] };

function drawResourceGraph(id, values, color, unit, minMax) {
  const canvas = document.getElementById(id);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || 300;
  const h = 150;
  canvas.width = w;
  canvas.height = h;

  const left = 40, right = 10, top = 12, bottom = 24;
  const pw = w - left - right, ph = h - top - bottom;
  const valid = values.filter(Number.isFinite);
  const max = Math.max(minMax, ...valid);

  ctx.clearRect(0, 0, w, h);
  ctx.font = '10px sans-serif';
  ctx.strokeStyle = '#343447';
  ctx.fillStyle = '#a5a5bd';

  for (let i = 0; i <= 4; i++) {
    const y = top + ph * i / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(w - right, y);
    ctx.stroke();
    ctx.fillText((max * (1 - i / 4)).toFixed(0) + unit, 2, y + 3);
  }

  if (valid.length < 2) {
    ctx.fillText('Collecting samples...', left + 8, top + 20);
    return;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();

  valid.forEach((v, i) => {
    const x = left + pw * i / (valid.length - 1);
    const y = top + ph * (1 - v / max);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
  ctx.fillStyle = '#a5a5bd';
  ctx.fillText('Older', left, h - 5);
  ctx.fillText('Latest', w - 43, h - 5);
}

function updateResourceGraphs(services) {
  const running = services.filter(s => s.state === 'RUNNING');
  const cpu = running.map(s => s.cpuPercent)
    .filter(v => typeof v === 'number' && Number.isFinite(v));
  const ram = running.map(s => s.memoryMB)
    .filter(v => typeof v === 'number' && Number.isFinite(v));

  resourceHistory.cpu.push(cpu.reduce((a, b) => a + b, 0));
  resourceHistory.ram.push(ram.reduce((a, b) => a + b, 0));

  resourceHistory.cpu = resourceHistory.cpu.slice(-24);
  resourceHistory.ram = resourceHistory.ram.slice(-24);

  drawResourceGraph('cpuGraph', resourceHistory.cpu, '#a78bfa', '%', 10);
  drawResourceGraph('ramGraph', resourceHistory.ram, '#38bdf8', ' MB', 50);
}
async function loadResources() {
  const message = document.getElementById('resourceMessage');
  const target = document.getElementById('resourceControls');
  if (!message || !target) return;

  try {
    const data = await api('/api/resources');
    target.replaceChildren();

    if (!data.running) {
      message.textContent = data.message || 'Daemon unavailable.';
      return;
    }

    const services = data.services || [];
    updateResourceGraphs(services);
    if (!services.length) {
      message.textContent = 'Daemon connected; no active services reported. Start a service to view CPU and RAM usage.';
      return;
    }

    message.textContent = 'Live readings from Linux /proc.';
    for (const service of services) {
      const card = document.createElement('div');
      card.className = 'card';

      const title = document.createElement('div');
      title.className = 'stat-label';
      title.textContent = service.name + ' · ' + service.state;

      const pid = document.createElement('div');
      pid.className = 'stat-value';
      pid.style.fontSize = '18px';
      pid.textContent = service.pid ? 'PID ' + service.pid : 'No PID';

      const details = document.createElement('div');
      details.className = 'file';

      if (service.state !== 'RUNNING') {
        details.textContent = 'Stopped; metrics unavailable.';
      } else {
        const cpu = service.cpuPercent == null ? 'Sampling…' : service.cpuPercent + '%';
        const ram = service.memoryMB == null ? 'Unavailable' : service.memoryMB + ' MB';
        details.textContent = 'CPU: ' + cpu + ' · RAM: ' + ram;
      }

      card.append(title, pid, details);
      target.appendChild(card);
    }
  } catch (error) {
    message.textContent = 'Could not load metrics: ' + error.message;
  }
}

loadServices();
checkStatus();
loadLogs();
loadResources();
setInterval(loadResources, 2500);
setInterval(() => { loadLogs(); checkStatus(); }, 1500);
</script>
</body>
</html>`;

app.get('/', (req, res) => res.send(page));

app.get('/api/services', (req, res) => {
    res.json({ services: readServices() });
});


const resourceSamples = new Map();

app.get('/api/resources', (req, res) => {
    execFile('./minictl', ['status'], {
        cwd: ROOT,
        timeout: 2000
    }, (error, stdout, stderr) => {
        const message = (stdout || stderr || '').trim();

        if (error || !message.includes('OK:')) {
            return res.json({
                running: false,
                services: [],
                message: 'Daemon unavailable; resource readings cannot be collected.'
            });
        }

        const now = Date.now();
        const services = [];

        for (const line of message.split(/\r?\n/)) {
            const item = line.match(
                /^\s*([^:]+):\s*(RUNNING|STOPPED)(?:\s*\(PID=(\d+)\))?/i
            );

            if (!item) continue;

            const service = {
                name: item[1].trim(),
                state: item[2].toUpperCase(),
                pid: item[3] ? Number(item[3]) : null,
                cpuPercent: null,
                memoryMB: null,
                memoryPercent: null
            };

            if (service.state === 'RUNNING' && service.pid) {
                try {
                    const stat = fs.readFileSync(
                        '/proc/' + service.pid + '/stat', 'utf8'
                    );
                    const closeParen = stat.lastIndexOf(')');
                    if (closeParen < 0) throw new Error('Invalid process stat');

                    const fields = stat.slice(closeParen + 1).trim().split(/\s+/);
                    const ticks = Number(fields[11]) + Number(fields[12]);

                    const previous = resourceSamples.get(service.pid);

                    if (previous && now > previous.time && ticks >= previous.ticks) {
                        const elapsedSeconds = (now - previous.time) / 1000;
                        service.cpuPercent = Math.round(
                            ((ticks - previous.ticks) / 100 / elapsedSeconds) * 1000
                        ) / 10;
                    }

                    resourceSamples.set(service.pid, { ticks, time: now });

                    const status = fs.readFileSync(
                        '/proc/' + service.pid + '/status', 'utf8'
                    );
                    const rss = status.match(/^VmRSS:\s+(\d+)\s+kB/im);
                    const total = fs.readFileSync('/proc/meminfo', 'utf8')
                        .match(/^MemTotal:\s+(\d+)\s+kB/im);

                    if (rss) {
                        const rssKB = Number(rss[1]);
                        service.memoryMB = Math.round(rssKB / 1024 * 100) / 100;

                        if (total && Number(total[1]) > 0) {
                            service.memoryPercent = Math.round(
                                rssKB / Number(total[1]) * 10000
                            ) / 100;
                        }
                    }
                } catch (e) {
                    service.message = 'Process ended or its metrics are unavailable.';
                    resourceSamples.delete(service.pid);
                }
            }

            services.push(service);
        }

        const activePids = new Set(
            services.filter(s => s.state === 'RUNNING' && s.pid).map(s => s.pid)
        );
        for (const pid of resourceSamples.keys()) {
            if (!activePids.has(pid)) resourceSamples.delete(pid);
        }

        res.json({ running: true, services });
    });
});

app.get('/api/logs', (req, res) => {
    res.json({ logs });
});

app.get('/api/status', (req, res) => {
    execFile('./minictl', ['status'], {
        cwd: ROOT,
        timeout: 2000
    }, (error, stdout, stderr) => {
        const message = (stdout || stderr || '').trim();
        const match = message.match(/Active services\s*=\s*(\d+)/i);
        const services = [];
        for (const line of message.split(/\r?\n/)) {
            const item = line.match(/^\s*([^:]+):\s*(RUNNING|STOPPED)(?:\s*\(PID=(\d+)\))?/i);
            if (item) {
                services.push({
                    name: item[1].trim(),
                    state: item[2].toUpperCase(),
                    pid: item[3] ? Number(item[3]) : null
                });
            }
        }
        res.json({
            running: !error && message.includes('OK:'),
            activeCount: match ? Number(match[1]) : null,
            services,
            message: message || (error ? 'Daemon is not responding to minictl.' : '')
        });
    });
});

app.post('/api/run', (req, res) => {
    if (daemonProcess && daemonProcess.exitCode === null) {
        return res.status(409).json({
            error: 'The daemon was already started from this dashboard.'
        });
    }

    addLog('Request received: starting the real C daemon.');
    addLog('Command: ./minisystemd');

    let child;
    try {
        child = spawn('stdbuf', ['-oL', '-eL', './minisystemd'], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch (error) {
        addLog('Could not start daemon: ' + error.message);
        return res.status(500).json({ error: error.message });
    }

    daemonProcess = child;

    child.stdout.on('data', chunk => {
        chunk.toString().split(/\r?\n/).filter(Boolean).forEach(addLog);
    });

    child.stderr.on('data', chunk => {
        chunk.toString().split(/\r?\n/).filter(Boolean)
            .forEach(line => addLog('[stderr] ' + line));
    });

    child.on('error', error => {
        addLog('Process launch error: ' + error.message);
    });

    child.on('close', (code, signal) => {
        addLog('Daemon process ended. Exit code: ' + code + ', signal: ' + signal);
        if (daemonProcess === child) daemonProcess = null;
    });

    res.json({ message: 'Daemon launch requested. Output will appear in the log panel.' });
});

app.use(express.json());

app.post('/api/service/start', (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();

    if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name)) {
        return res.status(400).json({error: 'Invalid service name.'});
    }

    const knownServices = readServices().map(service => {
        const nameMatch = service.content.match(/^\\s*Name\\s*=\\s*(.+)\\s*$/mi);
        return nameMatch ? nameMatch[1].trim() : path.basename(service.file, '.service');
    });

    if (!knownServices.includes(name)) {
        return res.status(404).json({error: 'Service not found in services/.'});
    }

    execFile('./minictl', ['start', name], {
        cwd: ROOT,
        timeout: 4000
    }, (error, stdout, stderr) => {
        const message = (stdout || stderr || '').trim();
        addLog('minictl start ' + name + ': ' + (message || (error ? error.message : 'Request completed.')));

        if (error && !message) {
            return res.status(502).json({error: 'Could not contact the daemon: ' + error.message});
        }
        if (/ERROR:/i.test(message)) {
            return res.status(400).json({error: message});
        }
        res.json({message: message || 'Start request completed.'});
    });
});

app.post('/api/demo', (req, res) => {
    const allowed = ['reaping', 'dependency', 'circular', 'restart'];
    const feature = req.body && req.body.feature;

    if (!allowed.includes(feature)) {
        return res.status(400).json({error: 'Unknown demo feature.'});
    }

    if (daemonProcess && daemonProcess.exitCode === null) {
        return res.status(409).json({
            error: 'Stop the normal daemon before running a feature demo.'
        });
    }

    if (demoProcess) {
        return res.status(409).json({error: 'A feature demo is already running.'});
    }

    addLog('========================================');
    addLog('Dashboard requested feature demo: ' + feature);
    addLog('Running ./demo.sh ' + feature);

    const child = spawn('bash', ['./demo.sh', feature], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    demoProcess = child;

    child.stdout.on('data', chunk => {
        const output = chunk.toString();
        process.stdout.write(output);
        output.split(/\\r?\\n/).filter(Boolean).forEach(addLog);
    });
    child.stderr.on('data', chunk => {
        const output = chunk.toString();
        process.stderr.write(output);
        output.split(/\\r?\\n/).filter(Boolean)
            .forEach(line => addLog('[stderr] ' + line));
    });
    child.on('error', error => {
        addLog('Demo launch error: ' + error.message);
        if (demoProcess === child) demoProcess = null;
    });
    child.on('close', (code, signal) => {
        addLog('Demo finished. Exit code: ' + code + ', signal: ' + signal);
        if (demoProcess === child) demoProcess = null;
    });

    res.json({message: 'Demo started. Follow its output in the dashboard logs.'});
});

app.listen(PORT, '127.0.0.1', () => {
    console.log('MiniSystemd dashboard running at http://localhost:' + PORT);
});
