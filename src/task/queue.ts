import type { Message, ProcessId, Task, TaskId } from "../types.ts";
import { TaskStatus } from "../types.ts";

interface TaskOptions {
  timeout?: number;
  retries?: number;
  priority?: number;
}

export class TaskQueue<T = Message> {
  private tasks = new Map<TaskId, Task<T>>();
  private order: TaskId[] = [];
  private nextId = 0;

  enqueue(payload: T, options?: TaskOptions): Task<T> {
    const id = `task-${++this.nextId}` as TaskId;
    const task: Task<T> & { retriesLeft?: number; priority?: number } = {
      id,
      payload,
      createdAt: Date.now(),
      status: TaskStatus.Pending,
      retriesLeft: options?.retries,
      priority: options?.priority ?? 0,
    };
    this.tasks.set(id, task);
    this.order.push(id);
    this.order.sort((a, b) => {
      const ta = this.tasks.get(a) as any;
      const tb = this.tasks.get(b) as any;
      return (tb?.priority ?? 0) - (ta?.priority ?? 0);
    });
    return task;
  }

  takeNext(workerPid: ProcessId): Task<T> | null {
    for (const id of this.order) {
      const task = this.tasks.get(id);
      if (task && task.status === TaskStatus.Pending) {
        task.status = TaskStatus.Running;
        task.assignedTo = workerPid;
        task.startedAt = Date.now();
        return task;
      }
    }
    return null;
  }

  complete(id: TaskId, result?: Message, error?: string): Task<T> | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    task.completedAt = Date.now();
    if (error) {
      task.status = TaskStatus.Failed;
      task.error = error;
    } else {
      task.status = TaskStatus.Completed;
      task.result = result;
    }

    return task;
  }

  requeue(id: TaskId): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    task.status = TaskStatus.Pending;
    task.assignedTo = undefined;
    task.startedAt = undefined;
    return true;
  }

  get(id: TaskId): Task<T> | undefined {
    return this.tasks.get(id);
  }

  getAll(): Task<T>[] {
    return Array.from(this.tasks.values());
  }

  getPendingCount(): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === TaskStatus.Pending) count++;
    }
    return count;
  }

  getInFlightByWorker(workerPid: ProcessId): Task<T>[] {
    const result: Task<T>[] = [];
    for (const task of this.tasks.values()) {
      if (task.assignedTo === workerPid && task.status === TaskStatus.Running) {
        result.push(task);
      }
    }
    return result;
  }
}
