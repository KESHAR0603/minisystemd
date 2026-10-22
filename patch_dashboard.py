from pathlib import Path
import shutil

file = Path("server.js")
source = file.read_text()

replacements = [
    (
        "let daemonProcess = null;\nlet logs = [];",
        "let daemonProcess = null;\nlet demoProcess = null;\nlet logs = [];"
    ),
    (
        '  <div class="notice">Live local dashboard. Service definitions and daemon output are read from your project. Per-service running states are not currently exposed by the C IPC protocol.</div>',
        '''  <div class="notice">Live local dashboard. Service definitions and daemon output are read from your project. Per-service running states are not currently exposed by the C IPC protocol.</div>
  <section class="panel" style="margin-bottom:18px">
    <h2>🧪 Feature Demonstrations</h2>
    <p style="color:var(--muted);font-size:13px">Run each test separately. Original service files are restored after each test.</p>
    <div class="actions">
      <button class="primary demo-button" onclick="runDemo('reaping', this)">Test Process Reaping</button>
      <button class="demo-button" onclick="runDemo('dependency', this)">Test Dependency Ordering</button>
      <button class="demo-button" onclick="runDemo('circular', this)">Test Circular Dependency</button>
      <button class="demo-button" onclick="runDemo('restart', this)">Test Automatic Restart</button>
    </div>
  </section>'''
    ),
    (
        "async function loadServices() {",
        '''async function runDemo(feature, button) {
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

async function loadServices() {'''
    ),
    (
        "app.listen(PORT, '127.0.0.1', () => {",
        '''app.use(express.json());

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
        chunk.toString().split(/\\\\r?\\\\n/).filter(Boolean).forEach(addLog);
    });
    child.stderr.on('data', chunk => {
        chunk.toString().split(/\\\\r?\\\\n/).filter(Boolean)
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

app.listen(PORT, '127.0.0.1', () => {'''
    )
]

# Validate all expected snippets before modifying anything.
for old, new in replacements:
    count = source.count(old)
    if count != 1:
        raise SystemExit(
            f"Patch stopped safely: expected one match, found {count} for:\\n{old[:100]}"
        )

backup = Path("server.js.before-demos")
shutil.copy2(file, backup)

for old, new in replacements:
    source = source.replace(old, new, 1)

file.write_text(source)
print("Dashboard patch applied.")
print(f"Backup saved as: {backup}")
