import type { ProcessId, Message } from "../types.ts";
import { ProcessRegistry } from "./registry.ts";
import { isLocalPid, parsePid } from "./pid.ts";
import { MessageType } from "../protocol/protocol.ts";
import type { NodeConnection } from "../protocol/connection.ts";
import type { NodeRegistry } from "../node/registry.ts";
import type { ProcessLinker } from "./linker.ts";

interface PendingRequest {
  resolve: (message: Message | null) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface RequestMessage {
  __zukov_request: true;
  correlationId: string;
  payload: Message;
}

interface ReplyMessage {
  __zukov_reply: true;
  correlationId: string;
  payload: Message;
}

export class MessageRouter {
  private connections = new Map<string, NodeConnection>();
  private pendingRequests = new Map<string, PendingRequest>();
  private correlationCounter = 0;
  private replyProcess?: ProcessId;

  constructor(
    private registry: ProcessRegistry,
    private nodeRegistry: NodeRegistry,
    private nodeId: string,
    private linker?: ProcessLinker,
  ) {}

  setLinker(linker: ProcessLinker): void {
    this.linker = linker;
  }

  private generateCorrelationId(): string {
    return `${this.nodeId}-${Date.now()}-${++this.correlationCounter}`;
  }

  setConnection(nodeId: string, conn: NodeConnection): void {
    this.connections.set(nodeId, conn);
  }

  removeConnection(nodeId: string): void {
    this.connections.delete(nodeId);
  }

  send(to: ProcessId, message: Message, from?: ProcessId): boolean {
    if (this.isReply(message)) {
      const targetPid = this.replyProcess || to;
      if (!isLocalPid(targetPid, this.nodeId)) {
        return this.sendRemote(targetPid, message, from);
      }
      const process = this.registry.get(targetPid);
      if (process && process.state !== "terminated") {
        process.send(message);
        return true;
      }
      return false;
    }

    if (!isLocalPid(to, this.nodeId)) {
      return this.sendRemote(to, message, from);
    }

    const process = this.registry.get(to);
    if (!process) {
      console.warn(`Process not found: ${to}`);
      return false;
    }

    if (process.state === "terminated") {
      return false;
    }

    process.send(message);
    return true;
  }

  sendRemote(to: ProcessId, message: Message, from?: ProcessId): boolean {
    const { nodeId: targetNodeId } = parsePid(to);
    const conn = this.connections.get(targetNodeId);

    if (!conn || conn.isClosed()) {
      const node = this.nodeRegistry.get(targetNodeId);
      if (!node || !node.connected) {
        console.warn(`No connection to node ${targetNodeId} for process ${to}`);
        return false;
      }
    }

    if (conn) {
      return conn.send(MessageType.Send, {
        to,
        from: from || `${this.nodeId}:0`,
        message,
      });
    }

    return false;
  }

  sendLink(pid1: ProcessId, pid2: ProcessId): boolean {
    if (isLocalPid(pid1, this.nodeId) && isLocalPid(pid2, this.nodeId)) {
      this.linker?.link(pid1, pid2);
      return true;
    }

    if (isLocalPid(pid1, this.nodeId) && !isLocalPid(pid2, this.nodeId)) {
      const { nodeId: targetNodeId } = parsePid(pid2);
      const conn = this.connections.get(targetNodeId);
      if (conn) {
        conn.send(MessageType.Link, { pid1, pid2 });
        this.linker?.link(pid1, pid2);
        return true;
      }
      return false;
    }

    if (!isLocalPid(pid1, this.nodeId) && isLocalPid(pid2, this.nodeId)) {
      const { nodeId: targetNodeId } = parsePid(pid1);
      const conn = this.connections.get(targetNodeId);
      if (conn) {
        conn.send(MessageType.Link, { pid1, pid2 });
        this.linker?.link(pid1, pid2);
        return true;
      }
      return false;
    }

    return false;
  }

  sendUnlink(pid1: ProcessId, pid2: ProcessId): void {
    this.linker?.unlink(pid1, pid2);

    if (!isLocalPid(pid1, this.nodeId)) {
      const { nodeId: targetNodeId } = parsePid(pid1);
      const conn = this.connections.get(targetNodeId);
      conn?.send(MessageType.Link, { pid1, pid2, unlink: true });
    }
    if (!isLocalPid(pid2, this.nodeId)) {
      const { nodeId: targetNodeId } = parsePid(pid2);
      const conn = this.connections.get(targetNodeId);
      conn?.send(MessageType.Link, { pid1, pid2, unlink: true });
    }
  }

  sendMonitor(fromPid: ProcessId, toPid: ProcessId): string {
    const ref = this.linker?.generateRef() || `monitor-${Date.now()}`;

    if (isLocalPid(toPid, this.nodeId)) {
      this.linker?.monitor(fromPid, toPid);
      return ref;
    }

    const { nodeId: targetNodeId } = parsePid(toPid);
    const conn = this.connections.get(targetNodeId);
    if (conn) {
      conn.send(MessageType.Monitor, { ref, fromPid, toPid });
      this.linker?.monitor(fromPid, toPid);
    }

    return ref;
  }

  sendDemonitor(ref: string, fromPid: ProcessId, toPid: ProcessId): boolean {
    this.linker?.demonitor(ref);

    if (!isLocalPid(toPid, this.nodeId)) {
      const { nodeId: targetNodeId } = parsePid(toPid);
      const conn = this.connections.get(targetNodeId);
      if (conn) {
        conn.send(MessageType.Monitor, { ref, fromPid, toPid, demonitor: true });
        return true;
      }
      return false;
    }

    return true;
  }

  async sendExit(fromPid: ProcessId, toPid: ProcessId, reason: string): Promise<void> {
    if (isLocalPid(toPid, this.nodeId)) {
      const process = this.registry.get(toPid);
      if (process && process.state !== "terminated") {
        process.send({ type: "exit", fromPid, toPid, reason });
      }
    } else {
      const { nodeId: targetNodeId } = parsePid(toPid);
      const conn = this.connections.get(targetNodeId);
      conn?.send(MessageType.Exit, { fromPid, toPid, reason });
    }
  }

  async sendDown(ref: string, fromPid: ProcessId, toPid: ProcessId, reason: string): Promise<void> {
    if (isLocalPid(fromPid, this.nodeId)) {
      const process = this.registry.get(fromPid);
      if (process && process.state !== "terminated") {
        process.send({ type: "down", ref, toPid, fromPid, reason });
      }
    } else {
      const { nodeId: targetNodeId } = parsePid(fromPid);
      const conn = this.connections.get(targetNodeId);
      conn?.send(MessageType.Down, { ref, fromPid, toPid, reason });
    }
  }

  async sendAndWait(
    to: ProcessId,
    message: Message,
    timeout = 5000
  ): Promise<Message | null> {
    const correlationId = this.generateCorrelationId();
    const replyTo = await this.ensureReplyProcess();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        resolve(null);
      }, timeout);

      this.pendingRequests.set(correlationId, {
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timeout: timer,
      });

      const requestMessage: RequestMessage = {
        __zukov_request: true,
        correlationId,
        payload: message,
      };

      if (!this.send(to, requestMessage)) {
        clearTimeout(timer);
        this.pendingRequests.delete(correlationId);
        resolve(null);
      }
    });
  }

  private async ensureReplyProcess(): Promise<ProcessId> {
    if (this.replyProcess) {
      const process = this.registry.get(this.replyProcess);
      if (process && process.state !== "terminated") {
        return this.replyProcess;
      }
    }
    throw new Error("Reply process not initialized");
  }

  handleReply(reply: ReplyMessage): void {
    const pending = this.pendingRequests.get(reply.correlationId);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(reply.correlationId);
    clearTimeout(pending.timeout);
    pending.resolve(reply.payload);
  }

  sendReply(to: ProcessId, correlationId: string, payload: Message): boolean {
    const reply: ReplyMessage = {
      __zukov_reply: true,
      correlationId,
      payload,
    };
    return this.send(to, reply);
  }

  isRequest(message: Message): message is RequestMessage {
    return (
      typeof message === "object" &&
      message !== null &&
      "__zukov_request" in message &&
      (message as RequestMessage).__zukov_request === true
    );
  }

  isReply(message: Message): message is ReplyMessage {
    return (
      typeof message === "object" &&
      message !== null &&
      "__zukov_reply" in message &&
      (message as ReplyMessage).__zukov_reply === true
    );
  }

  setReplyProcess(pid: ProcessId): void {
    this.replyProcess = pid;
  }

  extractRequest(message: Message): { correlationId: string; payload: Message } | null {
    if (this.isRequest(message)) {
      return {
        correlationId: message.correlationId,
        payload: message.payload,
      };
    }
    return null;
  }

  createReply(correlationId: string, payload: Message): ReplyMessage {
    return {
      __zukov_reply: true,
      correlationId,
      payload,
    };
  }

  async handleRemoteExit(fromPid: ProcessId, toPid: ProcessId, reason: string): Promise<void> {
    if (isLocalPid(toPid, this.nodeId)) {
      const process = this.registry.get(toPid);
      if (process && process.state !== "terminated") {
        process.send({ type: "exit", fromPid, toPid, reason });
      }
    }
  }

  async handleRemoteDown(ref: string, fromPid: ProcessId, toPid: ProcessId, reason: string): Promise<void> {
    if (isLocalPid(fromPid, this.nodeId)) {
      const process = this.registry.get(fromPid);
      if (process && process.state !== "terminated") {
        process.send({ type: "down", ref, toPid, fromPid, reason });
      }
    }
  }
}
