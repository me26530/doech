import { connect } from 'cloudflare:sockets';

const encoder = new TextEncoder();
const WS_OPEN = 1;
const WS_CLOSING = 2;

// fallback IP 列表
const CF_FALLBACK_IPS = [
  "proxyip.cmliussss.net:443"
];

// 空闲关闭配置
const IDLE_TIMEOUT = 30 * 1000; // 30 秒无活动自动关闭
const CHECK_INTERVAL = 10 * 1000; // 每 10 秒检查一次

// 心跳配置
const HEARTBEAT_INTERVAL = 15 * 1000; // 每 15 秒发送一次 PING
const HEARTBEAT_TIMEOUT = 20 * 1000;  // 20 秒没收到 PONG 关闭

// TCP 写入合并配置
const FLUSH_INTERVAL = 5; // 5ms 内的写入合并成一次

export class TunnelProxy {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    this.handleSession(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSession(webSocket) {
    let remoteSocket = null;
    let remoteWriter = null;
    let remoteReader = null;
    let closed = false;

    let lastActive = Date.now();
    let lastPong = Date.now();

    // 写入合并缓冲区
    let writeBuffer = [];
    let flushScheduled = false;

    const flush = async () => {
      if (closed || !remoteWriter || writeBuffer.length === 0) return;
      const merged = mergeBuffers(writeBuffer);
      writeBuffer = [];
      flushScheduled = false;
      try {
        await remoteWriter.write(merged);
      } catch {
        cleanup();
      }
    };

    const scheduleFlush = () => {
      if (!flushScheduled) {
        flushScheduled = true;
        setTimeout(flush, FLUSH_INTERVAL);
      }
    };

    const cleanup = () => {
      if (closed) return;
      closed = true;

      try { remoteWriter?.releaseLock(); } catch {}
      try { remoteReader?.releaseLock(); } catch {}
      try { remoteSocket?.close(); } catch {}
      safeClose(webSocket);
    };

    // 空闲检查
    const idleChecker = setInterval(() => {
      if (closed) {
        clearInterval(idleChecker);
        return;
      }
      if (Date.now() - lastActive > IDLE_TIMEOUT) {
        cleanup();
        clearInterval(idleChecker);
      }
    }, CHECK_INTERVAL);

    // 心跳：服务端定期发 PING，客户端回 PONG
    const heartbeat = setInterval(() => {
      if (closed) {
        clearInterval(heartbeat);
        return;
      }
      if (Date.now() - lastPong > HEARTBEAT_TIMEOUT) {
        cleanup();
        clearInterval(heartbeat);
        return;
      }
      try {
        if (webSocket.readyState === WS_OPEN) {
          webSocket.send("PING");
        }
      } catch {}
    }, HEARTBEAT_INTERVAL);

    webSocket.addEventListener("close", () => {
      cleanup();
      clearInterval(idleChecker);
      clearInterval(heartbeat);
    });

    webSocket.addEventListener("error", () => {
      cleanup();
      clearInterval(idleChecker);
      clearInterval(heartbeat);
    });

    webSocket.addEventListener("message", async (event) => {
      if (closed) return;

      const data = event.data;
      lastActive = Date.now();

      // 心跳响应
      if (data === "PONG") {
        lastPong = Date.now();
        return;
      }

      try {
        // 首帧：CONNECT:host:port|initialData
        if (typeof data === "string" && data.startsWith("CONNECT:")) {
          const sep = data.indexOf("|", 8);
          if (sep < 0) {
            cleanup();
            return;
          }

          let target = data.substring(8, sep);
          const initial = data.substring(sep + 1);

          let [host, portStr] = target.split(":");
          let port = parseInt(portStr, 10);

          if (!host || !port) {
            [host, port] = CF_FALLBACK_IPS[0].split(":");
            port = parseInt(port, 10);
          }

          remoteSocket = connect({ hostname: host, port });
          remoteWriter = remoteSocket.writable.getWriter();
          remoteReader = remoteSocket.readable.getReader();

          if (initial) {
            await remoteWriter.write(encoder.encode(initial));
          }

          // TCP → WebSocket
          (async () => {
            try {
              while (true) {
                const { value, done } = await remoteReader.read();
                if (done) break;

                lastActive = Date.now();

                if (webSocket.readyState === WS_OPEN) {
                  webSocket.send(value);
                } else {
                  break;
                }
              }
            } catch {}
            cleanup();
          })();

          return;
        }

        // 后续数据：写入合并缓冲区 → TCP
        if (remoteWriter) {
          const payload =
            typeof data === "string" ? encoder.encode(data) : data;
          writeBuffer.push(payload);
          scheduleFlush();
        }
      } catch {
        cleanup();
      }
    });
  }
}

// 合并多个 Uint8Array
function mergeBuffers(buffers) {
  let total = 0;
  for (const b of buffers) total += b.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    merged.set(b, offset);
    offset += b.length;
  }
  return merged;
}

function safeClose(ws) {
  try {
    if (ws.readyState === WS_OPEN || ws.readyState === WS_CLOSING) {
      ws.close(1000, "Closed");
    }
  } catch {}
}
