const http = require('http');
const QRCode = require('qrcode');

let currentQr = null;
let connected = false;
let lastUpdate = 0;

function attachPairingWeb(socket) {
  socket.ev.on('connection.update', async ({ connection, qr, isNewLogin }) => {
    if (qr) {
      try {
        currentQr = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 360,
        });
        lastUpdate = Date.now();
      } catch (error) {
        console.error('❌ Failed to render pairing QR:', error?.message || error);
      }
    }

    if (isNewLogin || connection === 'open') {
      currentQr = null;
      connected = true;
      lastUpdate = Date.now();
    } else if (connection === 'close') {
      connected = false;
      lastUpdate = Date.now();
    }
  });
}

function startPairingWeb(port = Number(process.env.PAIRING_WEB_PORT || 3000)) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    if (req.url === '/api/pairing-status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        connected,
        qr: currentQr,
        updatedAt: lastUpdate,
      }));
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Pairing API listening on port ${port}`);
  });

  return server;
}

module.exports = {
  attachPairingWeb,
  startPairingWeb,
};
