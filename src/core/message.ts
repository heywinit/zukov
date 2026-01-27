import type { ProcessId, Message } from "../types.ts";
import { ProcessRegistry } from "./registry.ts";
import { isLocalPid, parsePid } from "./pid.ts";
import { MessageType } from "../protocol/protocol.ts";
import type { NodeConnection } from "../protocol/connection.ts";
import type { NodeRegistry } from "../node/registry.ts";

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
    private nodeId: string
  ) {}

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
    // Handle replies specially - they need to go to the reply process
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

    // If it's a request message, we need to handle the reply routing
    if (this.isRequest(message)) {
      process.send(message);
      return true;
    }

    process.send(message);
    return true;
  }

  private sendRemote(to: ProcessId, message: Message, from?: ProcessId): boolean {
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
}
