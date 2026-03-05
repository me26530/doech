import { TunnelProxy } from './do.js';

export { TunnelProxy };

const SHARD_COUNT = 4; // 可调：2 / 4 / 8
const token = "1105074071"; // 你自己的 token，不为空时强制校验

export default {
  async fetch(request, env, ctx) {
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    // token 校验（可选）
    if (token) {
      const proto = request.headers.get("Sec-WebSocket-Protocol");
      if (proto !== token) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    // 随机分片（适合个人使用）
    const shard = Math.floor(Math.random() * SHARD_COUNT);
    const id = env.TUNNEL_PROXY.idFromName(`pool-${shard}`);
    const stub = env.TUNNEL_PROXY.get(id);

    return stub.fetch(request);
  }
};
