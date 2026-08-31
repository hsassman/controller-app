import { encodePingFrame, decodePongSequence } from "../../protocol/frame.ts";

export type ConnectionState = "idle" | "connecting" | "connected" | "error" | "lost";

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 16000;

/// How often to send a heartbeat once connected.
const PING_INTERVAL_MS = 2000;
const STALE_AFTER_MS = PING_INTERVAL_MS * 3 + 500;

export class HostConnection {
  private socket: WebSocket | null = null;
  private socketListeners: AbortController | null = null;
  private onStateChange: (state: ConnectionState) => void;
  private onLatency: ((ms: number | null) => void) | null = null;
  private hostIpPort = "";
  private manualDisconnect = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private pingSequence = 0;
  /// Send time of each outstanding PING, keyed by sequence.
  private pendingPings = new Map<number, number>();
  private lastPongAt = 0;
  private latencyMs: number | null = null;

  constructor(onStateChange: (state: ConnectionState) => void) {
    this.onStateChange = onStateChange;
  }

  setStateHandler(onStateChange: (state: ConnectionState) => void): void {
    this.onStateChange = onStateChange;
  }

  /// Called with the latest round-trip time in ms, or null when the
  /// connection has no usable measurement (not yet connected, or stale).
  setLatencyHandler(onLatency: (ms: number | null) => void): void {
    this.onLatency = onLatency;
  }

  connect(hostIpPort: string): void {
    this.hostIpPort = hostIpPort;
    this.manualDisconnect = false;
    this.backoffMs = INITIAL_BACKOFF_MS;
    this.openSocket();
  }

  private openSocket(): void {
    // Defensive: never leave a previous socket open and listening. Two live
    // sockets would each run their own close/reconnect logic, so a single
    // stray one multiplies into a reconnect storm that is very hard to see.
    this.teardownSocket();
    this.onStateChange("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://${this.hostIpPort}/connect`);
    } catch {
      this.onStateChange("error");
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    const listeners = new AbortController();
    this.socketListeners = listeners;
    const opts = { signal: listeners.signal };

    socket.addEventListener("open", () => {
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.lastPongAt = performance.now();
      this.pendingPings.clear();
      this.onStateChange("connected");
      this.startHeartbeat();
    }, opts);
    socket.addEventListener("message", (event) => this.handleMessage(event), opts);
    socket.addEventListener("close", () => {
      this.stopHeartbeat();
      this.setLatency(null);
      if (this.manualDisconnect) return;
      this.onStateChange("lost");
      this.scheduleReconnect();
    }, opts);
    socket.addEventListener("error", () => this.onStateChange("error"), opts);
  }

  private handleMessage(event: MessageEvent): void {
    if (!(event.data instanceof ArrayBuffer)) return;
    const sequence = decodePongSequence(event.data);
    if (sequence === null) return;

    const sentAt = this.pendingPings.get(sequence);
    // An unmatched sequence is not an error worth acting on -- it just means
    // the reply outlived its entry (see the prune in sendPing).
    if (sentAt === undefined) return;
    this.pendingPings.delete(sequence);
    this.lastPongAt = performance.now();
    this.setLatency(Math.round(performance.now() - sentAt));
  }

  private setLatency(ms: number | null): void {
    if (this.latencyMs === ms) return;
    this.latencyMs = ms;
    this.onLatency?.(ms);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    this.sendPing();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.pendingPings.clear();
  }

  private sendPing(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;

    // Nothing has come back for three intervals: the socket claims to be
    // open but the peer is gone. Close it so the normal close/reconnect
    // path runs, instead of silently pretending to be connected.
    if (performance.now() - this.lastPongAt > STALE_AFTER_MS) {
      this.setLatency(null);
      this.socket.close();
      return;
    }

    const sequence = this.pingSequence;
    this.pingSequence = (this.pingSequence + 1) & 0xffff;
    this.pendingPings.set(sequence, performance.now());
    // Drop entries older than the staleness window so an unanswered ping
    // cannot accumulate in the map for the life of the session.
    const cutoff = performance.now() - STALE_AFTER_MS;
    for (const [key, sentAt] of this.pendingPings) {
      if (sentAt < cutoff) this.pendingPings.delete(key);
    }

    try {
      this.socket.send(encodePingFrame(sequence));
    } catch {
      // Send can throw if the socket closed between the readyState check
      // and here; the close handler will take it from there.
    }
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.openSocket();
    }, this.backoffMs);
  }

  sendFrame(frame: ArrayBuffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(frame);
    }
  }

  private teardownSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.socketListeners?.abort();
    this.socketListeners = null;
    this.stopHeartbeat();
    if (!socket) return;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try {
        socket.close();
      } catch {
        // Already closing — nothing to do.
      }
    }
  }

  disconnect(): void {
    this.manualDisconnect = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setLatency(null);
    this.teardownSocket();
  }
}
