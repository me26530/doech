import { TunnelProxy } from './do.js';

export { TunnelProxy };

const SHARD_COUNT = 4;
const token = "1105074071";

export default {
  async fetch(request, env, ctx) {
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    if (token && request.headers.get("Sec-WebSocket-Protocol") !== token) {
      return new Response("Unauthorized", { status: 401 });
    }

    const shard = Math.floor(Math.random() * SHARD_COUNT);
    const id = env.TUNNEL_PROXY.idFromName(`pool-${shard}`);
    const stub = env.TUNNEL_PROXY.get(id);

    return stub.fetch(request);
  }
};
