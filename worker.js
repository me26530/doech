import { TunnelProxy } from './do.js';

export { TunnelProxy };

const SHARD_COUNT = 4; // 你可以改成 2 / 4 / 8

export default {
  async fetch(request, env, ctx) {
    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // 随机分片（适合个人使用）
    const shard = Math.floor(Math.random() * SHARD_COUNT);
    const id = env.TUNNEL_PROXY.idFromName(`pool-${shard}`);
    const stub = env.TUNNEL_PROXY.get(id);

    return stub.fetch(request);
  },
};
