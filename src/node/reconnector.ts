import type { NodeId, ReconnectConfig } from "../types.ts";

type ReconnectCallback = (nodeId: NodeId) => void | Promise<void>;
type ReconnectSuccessCallback = (nodeId: NodeId) => void | Promise<void>;

interface ReconnectState {
  nodeId: NodeId;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
}

export class Reconnector {
  private pending = new Map<NodeId, ReconnectState>();
  private config: Required<ReconnectConfig>;
  private reconnectCallback?: ReconnectCallback;
  private reconnectSuccessCallback?: ReconnectSuccessCallback;

  constructor(config?: ReconnectConfig) {
    this.config = {
      maxRetries: config?.maxRetries ?? -1,
      maxDelay: config?.maxDelay ?? 30000,
      initialDelay: config?.initialDelay ?? 1000,
    };
  }

  setConfig(config: ReconnectConfig): void {
    if (config.maxRetries !== undefined) this.config.maxRetries = config.maxRetries;
    if (config.maxDelay !== undefined) this.config.maxDelay = config.maxDelay;
    if (config.initialDelay !== undefined) this.config.initialDelay = config.initialDelay;
  }

  onReconnect(callback: ReconnectCallback): void {
    this.reconnectCallback = callback;
  }

  onReconnectSuccess(callback: ReconnectSuccessCallback): void {
    this.reconnectSuccessCallback = callback;
  }

  scheduleReconnect(nodeId: NodeId, connectFn: () => Promise<boolean>): void {
    const existing = this.pending.get(nodeId);
    if (existing && !existing.cancelled) {
      return;
    }

    const state: ReconnectState = {
      nodeId,
      attempts: existing?.attempts ?? 0,
      timer: null,
      cancelled: false,
    };

    this.pending.set(nodeId, state);
    this.scheduleAttempt(state, connectFn);
  }

  cancelReconnect(nodeId: NodeId): void {
    const state = this.pending.get(nodeId);
    if (state) {
      state.cancelled = true;
      if (state.timer) {
        clearTimeout(state.timer);
      }
      this.pending.delete(nodeId);
    }
  }

  private scheduleAttempt(state: ReconnectState, connectFn: () => Promise<boolean>): void {
    if (state.cancelled) {
      this.pending.delete(state.nodeId);
      return;
    }

    if (this.config.maxRetries >= 0 && state.attempts >= this.config.maxRetries) {
      console.warn(
        `Reconnector: max retries (${this.config.maxRetries}) reached for node ${state.nodeId}`,
      );
      this.pending.delete(state.nodeId);
      return;
    }

    const delay = this.calculateDelay(state.attempts);
    state.attempts++;

    this.reconnectCallback?.(state.nodeId);

    state.timer = setTimeout(async () => {
      if (state.cancelled) {
        this.pending.delete(state.nodeId);
        return;
      }

      const success = await connectFn();
      if (success) {
        this.reconnectSuccessCallback?.(state.nodeId);
        this.pending.delete(state.nodeId);
      } else {
        this.scheduleAttempt(state, connectFn);
      }
    }, delay);
  }

  private calculateDelay(attempt: number): number {
    const exponential = this.config.initialDelay * Math.pow(2, attempt);
    return Math.min(exponential, this.config.maxDelay);
  }

  getPendingNodes(): NodeId[] {
    return Array.from(this.pending.values())
      .filter((s) => !s.cancelled)
      .map((s) => s.nodeId);
  }

  isReconnecting(nodeId: NodeId): boolean {
    const state = this.pending.get(nodeId);
    return state !== undefined && !state.cancelled;
  }

  stopAll(): void {
    for (const state of this.pending.values()) {
      state.cancelled = true;
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }
    this.pending.clear();
  }
}
