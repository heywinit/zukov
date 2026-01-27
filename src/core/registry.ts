/**
 * Process registry - tracks all processes in the node
 */

import type { Process, ProcessId } from "../types.ts";
import { ZukovProcess } from "./process.ts";

export class ProcessRegistry {
  private processes = new Map<ProcessId, Process>();

  /**
   * Register a process
   */
  register(process: Process): void {
    if (this.processes.has(process.pid)) {
      throw new Error(`Process ${process.pid} already registered`);
    }
    this.processes.set(process.pid, process);
  }

  /**
   * Unregister a process
   */
  unregister(pid: ProcessId): void {
    this.processes.delete(pid);
  }

  /**
   * Get a process by PID
   */
  get(pid: ProcessId): Process | undefined {
    return this.processes.get(pid);
  }

  /**
   * Check if a process exists
   */
  has(pid: ProcessId): boolean {
    return this.processes.has(pid);
  }

  /**
   * Get all registered processes
   */
  getAll(): Process[] {
    return Array.from(this.processes.values());
  }

  /**
   * Get count of registered processes
   */
  size(): number {
    return this.processes.size;
  }
}
