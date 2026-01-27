import { Node } from "./node.ts";
import type { NodeId } from "../types.ts";

export class NodeRegistry {
  private nodes = new Map<NodeId, Node>();
  private localNodeId: NodeId;

  constructor(localNodeId: NodeId) {
    this.localNodeId = localNodeId;
  }

  register(node: Node): void {
    if (node.id === this.localNodeId) {
      throw new Error("Cannot register local node");
    }
    if (this.nodes.has(node.id)) {
      throw new Error(`Node ${node.id} already registered`);
    }
    this.nodes.set(node.id, node);
  }

  unregister(nodeId: NodeId): void {
    this.nodes.delete(nodeId);
  }

  get(nodeId: NodeId): Node | undefined {
    return this.nodes.get(nodeId);
  }

  has(nodeId: NodeId): boolean {
    return this.nodes.has(nodeId);
  }

  getAll(): Node[] {
    return Array.from(this.nodes.values());
  }

  getConnected(): Node[] {
    return Array.from(this.nodes.values()).filter((node) => node.connected);
  }

  size(): number {
    return this.nodes.size;
  }

  getLocalNodeId(): NodeId {
    return this.localNodeId;
  }
}
