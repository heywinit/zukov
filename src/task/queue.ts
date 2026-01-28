import type { Message, ProcessId, Task, TaskId } from "../types.ts";
import { TaskStatus } from "../types.ts";

export class TaskQueue<T = Message> {
  private tasks = new Map<TaskId, Task<T>>();
  private order: TaskId[] = [];
  private nextId = 0;

  enqueue(payload: T): Task<T> {
    const id = `task-${++this.nextId}` as TaskId;
    const task: Task<T> = {
      id,
      payload,
      createdAt: Date.now(),
      status: TaskStatus.Pending,
    };
    this.tasks.set(id, task);
    this.order.push(id);
    return task;
  }

  takeNext(slavePid: ProcessId): Task<T> | null {
    for (const id of this.order) {
      const task = this.tasks.get(id);
      if (task && task.status === TaskStatus.Pending) {
        task.status = TaskStatus.Running;
        task.assignedTo = slavePid;
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

  get(id: TaskId): Task<T> | undefined {
    return this.tasks.get(id);
  }

  getAll(): Task<T>[] {
    return Array.from(this.tasks.values());
  }
}

