// Forward Expo Go traffic from the paired Tailscale iPhone to local Metro.
import net from 'node:net';
const phone = process.env.PHONE_PREVIEW_DEVICE;
const bind = process.env.PHONE_PREVIEW_BIND;
if (!phone || !bind) throw new Error('Set PHONE_PREVIEW_DEVICE and PHONE_PREVIEW_BIND to your private Tailscale IPv4 addresses.');
net.createServer(client => {
  if (client.remoteAddress !== phone) return client.destroy();
  const upstream = net.connect(8081, '127.0.0.1');
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
  client.pipe(upstream).pipe(client);
}).listen(8081, bind);
