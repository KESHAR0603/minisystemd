from pathlib import Path

p = Path("server.js")
s = p.read_text()

def replace_once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(
            f"Stopped safely: expected exactly one match for {label}, found {count}. "
            "No changes were written."
        )
    s = s.replace(old, new, 1)

replace_once(
'''  <div class="notice">Live local dashboard. Service definitions and daemon output are read from your project. Per-service running states are not currently exposed by the C IPC protocol.</div>''',
'''  <div class="notice">Feature 5 enabled: view live service states and start loaded services through the minictl Unix socket control plane.</div>''',
"dashboard notice"
)

replace_once(
'''  <section class="grid">
    <div class="panel">''',
'''  <section class="panel" style="margin:18px 0">
    <h2>🎛️ Service Control Center</h2>
    <p style="color:var(--muted);font-size:13px">Live states come from the running C daemon. Start requests use minictl.</p>
    <div id="serviceMessage" class="empty">Checking service status…</div>
    <div id="serviceControls"></div>
  </section>
  <section class="grid">
    <div class="panel">''',
"service control center"
)

replace_once(
'''async function checkStatus() {
  try {
    const data = await api('/api/status');
    document.getElementById('daemonState').textContent =
      data.running ? 'Connected' : 'Not running';
    document.getElementById('activeCount').textContent =
      data.activeCount === null ? 'Unavailable' : data.activeCount;
  } catch (error) {
    document.getElementById('daemonState').textContent = 'Unavailable';
    document.getElementById('activeCount').textContent = '—';
  }
}''',
'''async function checkStatus() {
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
}''',
"frontend status functions"
)

replace_once(
'''app.get('/api/status', (req, res) => {
    execFile('./minictl', ['status'], {
        cwd: ROOT,
        timeout: 2000
    }, (error, stdout, stderr) => {
        const message = (stdout || stderr || '').trim();
        const match = message.match(/Active services count\\\\s*=\\\\s*(\\\\d+)/i);
        res.json({
            running: !error && message.includes('OK:'),
            activeCount: match ? Number(match[1]) : null,
            message: message || (error ? 'Daemon is not responding to minictl.' : '')
        });
    });
});''',
'''app.get('/api/status', (req, res) => {
    execFile('./minictl', ['status'], {
        cwd: ROOT,
        timeout: 2000
    }, (error, stdout, stderr) => {
        const message = (stdout || stderr || '').trim();
        const match = message.match(/Active services\\\\s*=\\\\s*(\\\\d+)/i);
        const services = [];
        for (const line of message.split(/\\\\r?\\\\n/)) {
            const item = line.match(/^\\\\s*([^:]+):\\\\s*(RUNNING|STOPPED)(?:\\\\s*\\\\(PID=(\\\\d+)\\\\))?/i);
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
});''',
"status API"
)

replace_once(
'''app.use(express.json());

app.post('/api/demo', (req, res) => {''',
'''app.use(express.json());

app.post('/api/service/start', (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();

    if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name)) {
        return res.status(400).json({error: 'Invalid service name.'});
    }

    const knownServices = readServices().map(service => {
        const nameMatch = service.content.match(/^\\\\s*Name\\\\s*=\\\\s*(.+)\\\\s*$/mi);
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

app.post('/api/demo', (req, res) => {''',
"service start API"
)

p.write_text(s)
print("Feature 5 dashboard changes applied successfully.")
