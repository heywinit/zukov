import type { NodeId } from "../types.ts";
import { NodeRegistry } from "../node/registry.ts";
import { MessageRouter } from "../core/message.ts";
import { connectToNode, type NodeConnection, type ConnectionHandler } from "../protocol/connection.ts";
import { MessageType } from "../protocol/protocol.ts";
import { ProcessRegistry } from "../core/registry.ts";

export class ConnectionManager {
  private connections = new Map<NodeId, NodeConnection>();

  constructor(
    private nodeRegistry: NodeRegistry,
    private processRegistry: ProcessRegistry,
    private router: MessageRouter,
  ) {}

  async connect(nodeId: NodeId): Promise<boolean> {
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
      },
      onError: (error) => {
        console.error(`Connection error with node ${nodeId}:`, error);
        node.markDisconnected();
      },
    };

    const conn = await connectToNode(node.address!, node.port!, nodeId, handler);
    if (!conn) {
      return false;
    }

    this.connections.set(nodeId, conn);
    this.router.setConnection(nodeId, conn);
    node.markConnected();

    return true;
  }

  disconnect(nodeId: NodeId): void {
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
    fromNodeId: NodeId
  ): Promise<void> {
    const decoder = new TextDecoder();
    const json = decoder.decode(payload);
    const data = JSON.parse(json);

    switch (type) {
      case MessageType.Send:
        const { to, message } = data;
        const process = this.processRegistry.get(to);
        if (process) {
          process.send(message);
        }
        break;

      case MessageType.Ping:
        const conn = this.connections.get(fromNodeId);
        if (conn) {
          conn.send(MessageType.Pong, { timestamp: Date.now() });
        }
        break;

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
}
