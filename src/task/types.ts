import type { Task, Message } from "../types.ts";

export type TaskHandler = (task: Task) => Promise<Message>;
