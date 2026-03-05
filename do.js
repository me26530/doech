import { connect } from 'cloudflare:sockets';

const encoder = new TextEncoder();
const WS_OPEN = 1;
const WS_CLOSING = 2;

const IDLE_TIMEOUT = 30 * 1000; // 30 秒无数据自动关闭
const CHECK_INTERVAL = 10 * 1000; // 每 10 秒检查一次

export class TunnelProxy {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    // 每个连接独立处理
    this.handleSession(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSession(webSocket) {
    let remoteSocket = null;
    let remoteWriter = null;
    let remoteReader = null;
    let closed = false;

    // 记录最后活跃时间
    let lastActive = Date.now();

    const cleanup = () => {
      if (closed) return;
      closed = true;

      try { remoteWriter?.releaseLock(); } catch {}
      try { remoteReader?.releaseLock(); } catch {}
      try { remoteSocket?.close(); } catch {}
      this.safeClose(webSocket);
    };

    // 定时检查是否空闲
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

    webSocket.addEventListener('close', () => {
      cleanup();
      clearInterval(idleChecker);
    });

    webSocket.addEventListener('error', () => {
      cleanup();
      clearInterval(idleChecker);
    });

    webSocket.addEventListener('message', async (event) => {
      if (closed) return;

      // 更新活跃时间
      lastActive = Date.now();

      try {
        const data = event.data;

        // CONNECT:host:port|initialData
        if (typeof data === 'string' && data.startsWith('CONNECT:')) {
          const sep = data.indexOf('|', 8);
          if (sep < 0) {
            cleanup();
            return;
          }

          const target = data.substring(8, sep);
          const initial = data.substring(sep + 1);

          const [host, portStr] = target.split(':');
          const port = parseInt(portStr, 10);

          remoteSocket = connect({ hostname: host, port });
          remoteWriter = remoteSocket.writable.getWriter();
          remoteReader = remoteSocket.readable.getReader();

          // 发送初始数据
          if (initial) {
            await remoteWriter.write(encoder.encode(initial));
          }

          // TCP → WebSocket
          (async () => {
            try {
              while (true) {
                const { value, done } = await remoteReader.read();
                if (done) break;

                // 更新活跃时间
                lastActive = Date.now();

                if (webSocket.readyState === WS_OPEN) {
                  webSocket.send(value);
                } else {
                  break;
                }
              }
            } catch {
              // ignore
            }
            cleanup();
          })();

          return;
        }

        // 普通数据 → 写入 TCP
        if (remoteWriter) {
          const payload =
            typeof data === 'string' ? encoder.encode(data) : data;
          await remoteWriter.write(payload);
        }
      } catch {
        cleanup();
      }
    });
  }

  safeClose(ws) {
    try {
      if (ws.readyState === WS_OPEN || ws.readyState === WS_CLOSING) {
        ws.close(1000, 'Closed');
      }
    } catch {}
  }
}
