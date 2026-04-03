import type { ProcessId } from "../types.ts";
import type { ProcessRegistry } from "./registry.ts";

interface LinkEntry {
  pid1: ProcessId;
  pid2: ProcessId;
}

interface MonitorEntry {
  ref: string;
  fromPid: ProcessId;
  toPid: ProcessId;
}

export type ExitHandler = (fromPid: ProcessId, toPid: ProcessId, reason: string) => void | Promise<void>;
export type DownHandler = (ref: string, toPid: ProcessId, fromPid: ProcessId, reason: string) => void | Promise<void>;

export class ProcessLinker {
  private links = new Map<string, Set<string>>();
  private monitors = new Map<string, MonitorEntry>();
  private monitorRefs = new Map<string, Set<string>>();
  private refCounter = 0;

  constructor(
    private registry: ProcessRegistry,
    private onExit: ExitHandler,
    private onDown: DownHandler,
  ) {}

  generateRef(): string {
    return `monitor-${++this.refCounter}`;
  }

  link(pid1: ProcessId, pid2: ProcessId): void {
    const key1 = pid1;
    const key2 = pid2;

    if (!this.links.has(key1)) {
      this.links.set(key1, new Set());
    }
    if (!this.links.has(key2)) {
      this.links.set(key2, new Set());
    }

    this.links.get(key1)!.add(key2);
    this.links.get(key2)!.add(key1);
  }

  unlink(pid1: ProcessId, pid2: ProcessId): void {
    this.links.get(pid1)?.delete(pid2);
    this.links.get(pid2)?.delete(pid1);

    if (this.links.get(pid1)?.size === 0) {
      this.links.delete(pid1);
    }
    if (this.links.get(pid2)?.size === 0) {
      this.links.delete(pid2);
    }
  }

  monitor(fromPid: ProcessId, toPid: ProcessId): string {
    const ref = this.generateRef();
    const entry: MonitorEntry = { ref, fromPid, toPid };
    this.monitors.set(ref, entry);

    if (!this.monitorRefs.has(toPid)) {
      this.monitorRefs.set(toPid, new Set());
    }
    this.monitorRefs.get(toPid)!.add(ref);

    return ref;
  }

  demonitor(ref: string): boolean {
    const entry = this.monitors.get(ref);
    if (!entry) return false;

    this.monitors.delete(ref);
    this.monitorRefs.get(entry.toPid)?.delete(ref);

    if (this.monitorRefs.get(entry.toPid)?.size === 0) {
      this.monitorRefs.delete(entry.toPid);
    }

    return true;
  }

  async processExited(pid: ProcessId, reason: string): Promise<void> {
    const linked = this.links.get(pid);
    if (linked) {
      for (const otherPid of linked) {
        const otherProcess = this.registry.get(otherPid);
        if (otherProcess && otherProcess.state !== "terminated") {
          await this.onExit(pid, otherPid, reason);
        }
      }
      for (const otherPid of linked) {
        this.links.get(otherPid)?.delete(pid);
        if (this.links.get(otherPid)?.size === 0) {
          this.links.delete(otherPid);
        }
      }
      this.links.delete(pid);
    }

    const refs = this.monitorRefs.get(pid);
    if (refs) {
      for (const ref of refs) {
        const entry = this.monitors.get(ref);
        if (entry) {
          const monitorProcess = this.registry.get(entry.fromPid);
          if (monitorProcess && monitorProcess.state !== "terminated") {
            await this.onDown(ref, pid, entry.fromPid, reason);
          }
          this.monitors.delete(ref);
        }
      }
      this.monitorRefs.delete(pid);
    }
  }

  getLinkedPids(pid: ProcessId): Set<string> {
    return this.links.get(pid) || new Set();
  }

  getMonitoredRefs(pid: ProcessId): Set<string> {
    return this.monitorRefs.get(pid) || new Set();
  }

  getMonitorEntry(ref: string): MonitorEntry | undefined {
    return this.monitors.get(ref);
  }

  unlinkAll(pid: ProcessId): void {
    const linked = this.links.get(pid);
    if (linked) {
      for (const otherPid of linked) {
        this.links.get(otherPid)?.delete(pid);
        if (this.links.get(otherPid)?.size === 0) {
          this.links.delete(otherPid);
        }
      }
      this.links.delete(pid);
    }

    const refs = this.monitorRefs.get(pid);
    if (refs) {
      for (const ref of refs) {
        this.monitors.delete(ref);
      }
      this.monitorRefs.delete(pid);
    }
  }
}
