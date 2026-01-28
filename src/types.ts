/**
 * Core types for Zukov
 */

export type NodeId = string;
export type LocalPid = number;
export type ProcessId = `${NodeId}:${LocalPid}`;

export enum ProcessState {
  Init = "init",
  Running = "running",
  Terminated = "terminated",
}

export interface Process {
  pid: ProcessId;
  state: ProcessState;
  mailbox: Message[];
  onMessage?: (message: Message) => void | Promise<void>;
  send(message: Message): void;
}

export type Message = unknown;

export interface ProcessSpec {
  init?: () => void | Promise<void>;
  handleMessage?: (message: Message) => void | Promise<void>;
}

export type TaskId = string;

export enum TaskStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
}

export interface Task<T = Message> {
  id: TaskId;
  payload: T;
  createdAt: number;
  status: TaskStatus;
  assignedTo?: ProcessId;
  startedAt?: number;
  completedAt?: number;
  result?: Message;
  error?: string;
}
