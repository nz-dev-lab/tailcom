const { WebSocket } = require('ws');
const ws = new WebSocket('ws://127.0.0.1:7654');
const t = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 3000);
ws.on('open',    () => { console.log('connected, sending ping...'); ws.send(JSON.stringify({ type: 'ping' })); });
ws.on('message', (d) => { console.log('received:', d.toString()); clearTimeout(t); ws.close(); });
ws.on('error',   (e) => { console.error('error:', e.message); clearTimeout(t); });
ws.on('close',   () => console.log('closed'));
