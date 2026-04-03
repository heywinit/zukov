import type { Message, ProcessId, Task, TaskId, TaskSpec } from "../types.ts";
import { TaskStatus } from "../types.ts";
import { TaskQueue } from "./queue.ts";

type TaskCompleteCallback = (task: Task) => void | Promise<void>;
type TaskFailedCallback = (task: Task) => void | Promise<void>;

export class TaskScheduler {
  private queue: TaskQueue;
  private workers = new Map<ProcessId, { handler: (task: Task) => Promise<Message>; busy: boolean }>();
  private taskCompleteCallback?: TaskCompleteCallback;
  private taskFailedCallback?: TaskFailedCallback;

  constructor() {
    this.queue = new TaskQueue();
  }

  submitTask<T = Message>(spec: TaskSpec<T>): Task<T> {
    const task = this.queue.enqueue(spec.payload, {
      timeout: spec.timeout,
      retries: spec.retries ?? 0,
      priority: spec.priority ?? 0,
    });
    this.tryAssignTask();
    return task;
  }

  startWorker(
    handler: (task: Task) => Promise<Message>,
  ): void {
    const workerPid = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as ProcessId;
    this.workers.set(workerPid, { handler, busy: false });
    this.tryAssignTask();
  }

  removeWorker(pid: ProcessId): void {
    const worker = this.workers.get(pid);
    if (worker) {
      this.workers.delete(pid);
      const inFlight = this.queue.getInFlightByWorker(pid);
      for (const task of inFlight) {
        if ((task as any).retriesLeft > 0) {
          (task as any).retriesLeft--;
          this.queue.requeue(task.id);
        } else {
          task.status = TaskStatus.Failed;
          task.error = "worker_removed";
          this.taskFailedCallback?.(task);
        }
      }
      this.tryAssignTask();
    }
  }

  async reportResult(taskId: TaskId, result: Message, error?: string): Promise<void> {
    const task = this.queue.complete(taskId, result, error);
    if (!task) return;

    const workerPid = task.assignedTo;
    if (workerPid) {
      const worker = this.workers.get(workerPid);
      if (worker) {
        worker.busy = false;
      }
    }

    if (error) {
      if ((task as any).retriesLeft > 0) {
        (task as any).retriesLeft--;
        this.queue.requeue(taskId);
        this.tryAssignTask();
      } else {
        await this.taskFailedCallback?.(task);
      }
    } else {
      await this.taskCompleteCallback?.(task);
    }

    this.tryAssignTask();
  }

  onTaskComplete(callback: TaskCompleteCallback): void {
    this.taskCompleteCallback = callback;
  }

  onTaskFailed(callback: TaskFailedCallback): void {
    this.taskFailedCallback = callback;
  }

  getQueue(): TaskQueue {
    return this.queue;
  }

  getWorkerCount(): number {
    return this.workers.size;
  }

  getPendingCount(): number {
    return this.queue.getPendingCount();
  }

  private async tryAssignTask(): Promise<void> {
    for (const [pid, worker] of this.workers) {
      if (worker.busy) continue;

      const task = this.queue.takeNext(pid);
      if (!task) break;

      worker.busy = true;

      try {
        const result = await worker.handler(task);
        await this.reportResult(task.id, result);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await this.reportResult(task.id, null, errorMsg);
      }
    }
  }
}
