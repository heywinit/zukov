import { MessageType } from "./protocol.ts";
import { serializeMessage, deserializeMessage, parsePayload } from "./serialize.ts";
import { FrameReader } from "./frame.ts";
import type { NodeId } from "../types.ts";
import { createAuthSignature, verifyAuthSignature, generateNonce, type AuthState } from "../security/auth.ts";

export interface ConnectionHandler {
  onMessage(type: MessageType, payload: Uint8Array): void | Promise<void>;
  onClose?(): void;
  onError?(error: Error): void;
  onAuthenticated?(): void;
}

enum AuthPhase {
  Handshake,
  Challenge,
  Response,
  Authenticated,
}

export class NodeConnection {
  private reader: FrameReader;
  private closed = false;
  private handler: ConnectionHandler;
  private authPhase = AuthPhase.Handshake;
  private authState: AuthState | null = null;
  private pendingMessages: Array<{ type: MessageType; data: unknown }> = [];

  constructor(
    private socket: any,
    private nodeId: NodeId,
    handler: ConnectionHandler,
    authSecret?: string,
  ) {
    this.reader = new FrameReader();
    this.handler = handler;
    if (authSecret) {
      this.authState = {
        nodeId,
        nonce: generateNonce(),
        authenticated: false,
        isServer: false,
      };
    }
  }

  setHandler(handler: ConnectionHandler): void {
    this.handler = handler;
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

      if (this.authState) {
        const authHandled = await this.handleAuthPhase(message.type, message.payload);
        if (authHandled) continue;
      }

      try {
        await this.handler.onMessage(message.type, message.payload);
      } catch (error) {
        console.error(`Error handling message from ${this.nodeId}:`, error);
      }
    }
  }

  private async handleAuthPhase(type: MessageType, payload: Uint8Array): Promise<boolean> {
    if (!this.authState) return false;

    if (this.authState.isServer) {
      switch (this.authPhase) {
        case AuthPhase.Handshake: {
          if (type === MessageType.NodeInfo) {
            const data = parsePayload<{ nodeId: string }>(payload);
            if (data) {
              this.authState.nodeId = data.nodeId;
              this.authPhase = AuthPhase.Challenge;
              this.send(MessageType.AuthChallenge, {
                nodeId: this.nodeId,
                nonce: this.authState.nonce,
              });
              return true;
            }
          }
          break;
        }
        case AuthPhase.Challenge: {
          if (type === MessageType.AuthResponse) {
            const data = parsePayload<{ nodeId: string; signature: string }>(payload);
            if (data) {
              const secret = (this as any)._authSecret || "";
              const valid = verifyAuthSignature(data.nodeId, this.authState.nonce!, data.signature, secret);
              if (valid) {
                this.authState.authenticated = true;
                this.authPhase = AuthPhase.Authenticated;
                this.send(MessageType.AuthAck, { nodeId: this.nodeId });
                this.handler.onAuthenticated?.();
                for (const pending of this.pendingMessages) {
                  this.send(pending.type, pending.data);
                }
                this.pendingMessages = [];
                return true;
              } else {
                this.send(MessageType.AuthReject, { reason: "invalid_signature" });
                this.close();
                return true;
              }
            }
          }
          break;
        }
      }
    } else {
      switch (this.authPhase) {
        case AuthPhase.Handshake: {
          this.send(MessageType.NodeInfo, { nodeId: this.nodeId });
          this.authPhase = AuthPhase.Challenge;
          return true;
        }
        case AuthPhase.Challenge: {
          if (type === MessageType.AuthChallenge) {
            const data = parsePayload<{ nodeId: string; nonce: string }>(payload);
            if (data) {
              const secret = (this as any)._authSecret || "";
              const signature = createAuthSignature(this.nodeId, data.nonce, secret);
              this.authPhase = AuthPhase.Response;
              this.send(MessageType.AuthResponse, {
                nodeId: this.nodeId,
                signature,
              });
              return true;
            }
          }
          break;
        }
        case AuthPhase.Response: {
          if (type === MessageType.AuthAck) {
            this.authState.authenticated = true;
            this.authPhase = AuthPhase.Authenticated;
            this.handler.onAuthenticated?.();
            for (const pending of this.pendingMessages) {
              this.send(pending.type, pending.data);
            }
            this.pendingMessages = [];
            return true;
          }
          if (type === MessageType.AuthReject) {
            const data = parsePayload<{ reason: string }>(payload);
            console.error(`Auth rejected: ${data?.reason}`);
            this.close();
            return true;
          }
          break;
        }
      }
    }

    return false;
  }

  handleIncomingData(data: Uint8Array): void {
    this.handleData(data);
  }

  send(type: MessageType, data: unknown): boolean {
    if (this.closed) {
      return false;
    }

    if (this.authState && this.authPhase !== AuthPhase.Authenticated && type !== MessageType.NodeInfo && type !== MessageType.AuthResponse && type !== MessageType.AuthChallenge) {
      this.pendingMessages.push({ type, data });
      return true;
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

  isAuthenticated(): boolean {
    return !this.authState || this.authState.authenticated;
  }
}

export async function connectToNode(
  address: string,
  port: number,
  nodeId: NodeId,
  handler: ConnectionHandler,
  authSecret?: string,
): Promise<NodeConnection | null> {
  try {
    let conn: NodeConnection | null = null;

    const socket = await Bun.connect({
      hostname: address,
      port: port,
      socket: {
        open(socket) {},
        data(socket, data) {
          if (conn) {
            conn.handleIncomingData(data);
          }
        },
        close(socket) {
          if (conn) {
            handler.onClose?.();
          }
        },
        error(socket, error) {
          if (conn) {
            handler.onError?.(error);
          }
        },
      },
    });

    conn = new NodeConnection(socket, nodeId, handler, authSecret);
    (conn as any)._authSecret = authSecret;

    if (!authSecret) {
      conn.send(MessageType.NodeInfo, { nodeId });
    }

    return conn;
  } catch (error) {
    console.error(`Failed to connect to node ${nodeId} at ${address}:${port}:`, error);
    return null;
  }
}

export async function listenForConnections(
  port: number,
  onConnection: (conn: NodeConnection, nodeId: NodeId) => void,
  authSecret?: string,
): Promise<any> {
  const server = Bun.listen({
    hostname: "0.0.0.0",
    port: port,
    socket: {
      open(socket) {
        const tempNodeId = `node-${Date.now()}`;
        const tempHandler: ConnectionHandler = {
          onMessage: async () => {},
          onClose: () => {
            socket.end();
          },
          onError: (error) => {
            console.error(`Connection error:`, error);
          },
        };

        const conn = new NodeConnection(socket, tempNodeId, tempHandler, authSecret);
        (conn as any)._authSecret = authSecret;
        (socket as any).zukovConn = conn;
        onConnection(conn, tempNodeId);
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
