import { kdjdo } from './do.js';

export { kdjdo };

export default {
  async fetch(request, env, ctx) {
    try {
      const token = '1105074071';
      const upgradeHeader = request.headers.get('Upgrade');

      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new URL(request.url).pathname === '/'
          ? new Response('Welcome to nginx!', { status: 200, headers: { 'Content-Type': 'text/html' } })
          : new Response('Expected WebSocket', { status: 426 });
      }

      if (token && request.headers.get('Sec-WebSocket-Protocol') !== token) {
        return new Response('Unauthorized', { status: 401 });
      }

      const id = env.KX_A.newUniqueId();
      const stub = env.KX_A.get(id);
      return stub.fetch(request);
    } catch (err) {
      return new Response(err.toString(), { status: 500 });
    }
  },
};
