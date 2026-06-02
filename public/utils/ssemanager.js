const clients = new Set();
const orderClients = new Map();

export function addClient(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  clients.add(res);
  res.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
}

export function addOrderClient(orderId, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  if (!orderClients.has(orderId)) orderClients.set(orderId, new Set());
  orderClients.get(orderId).add(res);
  res.on('close', () => {
    clearInterval(keepAlive);
    const set = orderClients.get(orderId);
    if (set) {
      set.delete(res);
      if (set.size === 0) orderClients.delete(orderId);
    }
  });
}

export function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(payload));
}

export function broadcastOrderUpdate(orderId, data) {
  const set = orderClients.get(orderId);
  if (!set) return;
  const payload = `event: orderStatus\ndata: ${JSON.stringify(data)}\n\n`;
  set.forEach(res => res.write(payload));
}