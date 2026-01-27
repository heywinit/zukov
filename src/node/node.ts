import type { NodeId } from "../types.ts";

export interface NodeInfo {
  id: NodeId;
  address?: string;
  port?: number;
  connected: boolean;
  lastSeen?: number;
}

export class Node {
  public readonly id: NodeId;
  public address?: string;
  public port?: number;
  public connected = false;
  public lastSeen?: number;

  constructor(id: NodeId, address?: string, port?: number) {
    this.id = id;
    this.address = address;
    this.port = port;
  }

  markConnected(): void {
    this.connected = true;
    this.lastSeen = Date.now();
  }

  markDisconnected(): void {
    this.connected = false;
  }

  updateLastSeen(): void {
    this.lastSeen = Date.now();
  }

  toInfo(): NodeInfo {
    return {
      id: this.id,
      address: this.address,
      port: this.port,
      connected: this.connected,
      lastSeen: this.lastSeen,
    };
  }
}
