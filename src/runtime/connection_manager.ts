import type { NodeId } from "../types.ts";
import { NodeRegistry } from "../node/registry.ts";
import { MessageRouter } from "../core/message.ts";
import { connectToNode, type NodeConnection, type ConnectionHandler } from "../protocol/connection.ts";
import { MessageType } from "../protocol/protocol.ts";
import { ProcessRegistry } from "../core/registry.ts";
import { Reconnector } from "../node/reconnector.ts";
import { parsePayload } from "../protocol/serialize.ts";

export class ConnectionManager {
  private connections = new Map<NodeId, NodeConnection>();
  private reconnector: Reconnector;

  constructor(
    private nodeRegistry: NodeRegistry,
    private processRegistry: ProcessRegistry,
    private router: MessageRouter,
  ) {
    this.reconnector = new Reconnector();
    this.reconnector.onReconnect((nodeId) => {
      console.log(`Reconnector: attempting reconnect to ${nodeId}`);
    });
    this.reconnector.onReconnectSuccess((nodeId) => {
      console.log(`Reconnector: successfully reconnected to ${nodeId}`);
    });
  }

  setReconnectConfig(config: { maxRetries?: number; maxDelay?: number; initialDelay?: number }): void {
    this.reconnector.setConfig(config);
  }

  async connect(nodeId: NodeId, authSecret?: string): Promise<boolean> {
    if (this.connections.has(nodeId)) {
      const conn = this.connections.get(nodeId)!;
      if (!conn.isClosed()) {
        return true;
      }
      this.connections.delete(nodeId);
    }

    const node = this.nodeRegistry.get(nodeId);
    if (!node || !node.address || !node.port) {
      return false;
    }

    const handler: ConnectionHandler = {
      onMessage: async (type, payload) => {
        await this.handleMessage(type, payload, nodeId);
      },
      onClose: () => {
        node.markDisconnected();
        this.connections.delete(nodeId);
        this.router.removeConnection(nodeId);
        this.reconnector.scheduleReconnect(nodeId, async () => {
          return await this.connect(nodeId, authSecret);
        });
      },
      onError: (error) => {
        console.error(`Connection error with node ${nodeId}:`, error);
        node.markDisconnected();
      },
    };

    const conn = await connectToNode(node.address!, node.port!, nodeId, handler, authSecret);
    if (!conn) {
      return false;
    }

    this.connections.set(nodeId, conn);
    this.router.setConnection(nodeId, conn);
    node.markConnected();

    return true;
  }

  disconnect(nodeId: NodeId): void {
    this.reconnector.cancelReconnect(nodeId);
    const conn = this.connections.get(nodeId);
    if (conn) {
      conn.close();
      this.connections.delete(nodeId);
      this.router.removeConnection(nodeId);
    }
  }

  private async handleMessage(
    type: MessageType,
    payload: Uint8Array,
    fromNodeId: NodeId,
  ): Promise<void> {
    switch (type) {
      case MessageType.Send: {
        const data = parsePayload<{ to: string; from: string; message: unknown }>(payload);
        if (data) {
          const process = this.processRegistry.get(data.to);
          if (process) {
            process.send(data.message);
          }
        }
        break;
      }

      case MessageType.Link: {
        const data = parsePayload<{ pid1: string; pid2: string; unlink?: boolean }>(payload);
        if (data) {
          if (data.unlink) {
            this.router.sendUnlink(data.pid1, data.pid2);
          } else {
            this.router.sendLink(data.pid1, data.pid2);
          }
        }
        break;
      }

      case MessageType.Monitor: {
        const data = parsePayload<{ ref: string; fromPid: string; toPid: string; demonitor?: boolean }>(payload);
        if (data) {
          if (data.demonitor) {
            this.router.sendDemonitor(data.ref, data.fromPid, data.toPid);
          } else {
            this.router.sendMonitor(data.fromPid, data.toPid);
          }
        }
        break;
      }

      case MessageType.Exit: {
        const data = parsePayload<{ fromPid: string; toPid: string; reason: string }>(payload);
        if (data) {
          await this.router.handleRemoteExit(data.fromPid, data.toPid, data.reason);
        }
        break;
      }

      case MessageType.Down: {
        const data = parsePayload<{ ref: string; fromPid: string; toPid: string; reason: string }>(payload);
        if (data) {
          await this.router.handleRemoteDown(data.ref, data.fromPid, data.toPid, data.reason);
        }
        break;
      }

      case MessageType.Ping: {
        const conn = this.connections.get(fromNodeId);
        if (conn) {
          conn.send(MessageType.Pong, { timestamp: Date.now() });
        }
        break;
      }

      case MessageType.AuthChallenge: {
        break;
      }

      case MessageType.AuthResponse: {
        break;
      }

      case MessageType.AuthAck: {
        break;
      }

      case MessageType.AuthReject: {
        const data = parsePayload<{ reason: string }>(payload);
        console.error(`Auth rejected by ${fromNodeId}: ${data?.reason}`);
        break;
      }

      default:
        console.warn(`Unhandled message type ${type} from node ${fromNodeId}`);
    }
  }

  getConnection(nodeId: NodeId): NodeConnection | undefined {
    return this.connections.get(nodeId);
  }

  getAllConnections(): NodeConnection[] {
    return Array.from(this.connections.values());
  }

  stopReconnector(): void {
    this.reconnector.stopAll();
  }
}
