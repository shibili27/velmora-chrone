const clients = new Set();

export function addClient(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 1000);
  clients.add(res);
  res.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
}

export function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(payload));
}