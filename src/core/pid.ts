/**
 * Process ID (PID) management
 * PIDs are unique identifiers for processes: node_id:local_id
 */

import type { ProcessId, NodeId, LocalPid } from "../types.js";

let localPidCounter = 0;

/**
 * Generate a new local PID
 */
export function generateLocalPid(): LocalPid {
  return ++localPidCounter;
}

/**
 * Create a full ProcessId from node ID and local PID
 */
export function createPid(nodeId: NodeId, localPid: LocalPid): ProcessId {
  return `${nodeId}:${localPid}`;
}

/**
 * Parse a ProcessId into its components
 */
export function parsePid(pid: ProcessId): { nodeId: NodeId; localPid: LocalPid } {
  const [nodeId, localPidStr] = pid.split(":");
  if (!nodeId || !localPidStr) {
    throw new Error(`Invalid PID format: ${pid}`);
  }
  const localPid = parseInt(localPidStr, 10);
  if (isNaN(localPid)) {
    throw new Error(`Invalid local PID in: ${pid}`);
  }
  return { nodeId, localPid };
}

/**
 * Check if a PID belongs to a specific node
 */
export function isLocalPid(pid: ProcessId, nodeId: NodeId): boolean {
  return pid.startsWith(`${nodeId}:`);
}
