import { MessageType } from "./protocol.ts";
import { serializeMessage, deserializeMessage } from "./serialize.ts";
import { FrameReader } from "./frame.ts";
import type { NodeId } from "../types.ts";

export interface ConnectionHandler {
  onMessage(type: MessageType, payload: Uint8Array): void | Promise<void>;
  onClose?(): void;
  onError?(error: Error): void;
}

export class NodeConnection {
  private reader: FrameReader;
  private closed = false;
  private handler: ConnectionHandler;

  constructor(
    private socket: any,
    private nodeId: NodeId,
    handler: ConnectionHandler
  ) {
    this.reader = new FrameReader();
    this.handler = handler;
    this.setupListeners();
  }

  setHandler(handler: ConnectionHandler): void {
    this.handler = handler;
  }

  private setupListeners(): void {
    // Bun's socket API uses callbacks in the connect options
    // We'll handle data in the socket.data callback
  }

  private async handleData(data: Uint8Array): Promise<void> {
    this.reader.append(data);

    while (true) {
      const frame = this.reader.readFrame();
      if (!frame) {
        break;
      }

      const message = deserializeMessage(frame);
      if (!message) {
        continue;
      }

      try {
        await this.handler.onMessage(message.type, message.payload);
      } catch (error) {
        console.error(`Error handling message from ${this.nodeId}:`, error);
      }
    }
  }

  handleIncomingData(data: Uint8Array): void {
    this.handleData(data);
  }

  send(type: MessageType, data: unknown): boolean {
    if (this.closed) {
      return false;
    }

    try {
      const frame = serializeMessage(type, data);
      this.socket.write(frame);
      return true;
    } catch (error) {
      console.error(`Error sending message to ${this.nodeId}:`, error);
      return false;
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.socket.end();
    }
  }

  isClosed(): boolean {
    return this.closed;
  }

  getNodeId(): NodeId {
    return this.nodeId;
  }
}

export async function connectToNode(
  address: string,
  port: number,
  nodeId: NodeId,
  handler: ConnectionHandler
): Promise<NodeConnection | null> {
  try {
    let conn: NodeConnection | null = null;
    
    const socket = await Bun.connect({
      hostname: address,
      port: port,
      socket: {
        open(socket) {
          // Connection opened
        },
        data(socket, data) {
          // Data will be handled by NodeConnection
          if (conn) {
            conn.handleIncomingData(data);
          }
        },
        close(socket) {
          // Close handled by NodeConnection
          if (conn) {
            handler.onClose?.();
          }
        },
        error(socket, error) {
          // Error handled by NodeConnection
          if (conn) {
            handler.onError?.(error);
          }
        },
      },
    });

    conn = new NodeConnection(socket, nodeId, handler);
    
    return conn;
  } catch (error) {
    console.error(`Failed to connect to node ${nodeId} at ${address}:${port}:`, error);
    return null;
  }
}

export async function listenForConnections(
  port: number,
  onConnection: (conn: NodeConnection, nodeId: NodeId) => void
): Promise<any> {
  const server = Bun.listen({
    hostname: "0.0.0.0",
    port: port,
    socket: {
      open(socket) {
        const nodeId = `node-${Date.now()}`;
        const tempHandler: ConnectionHandler = {
          onMessage: async () => {},
          onClose: () => {
            socket.end();
          },
          onError: (error) => {
            console.error(`Connection error:`, error);
          },
        };
        
        const conn = new NodeConnection(socket, nodeId, tempHandler);
        (socket as any).zukovConn = conn;
        onConnection(conn, nodeId);
      },
      data(socket, data) {
        const conn = (socket as any).zukovConn;
        if (conn) {
          conn.handleIncomingData(data);
        }
      },
      close(socket) {
        const conn = (socket as any).zukovConn;
        if (conn) {
          conn.close();
        }
      },
      error(socket, error) {
        console.error(`Socket error:`, error);
      },
    },
  });

  return server;
}
