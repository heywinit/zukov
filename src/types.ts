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
  onExit?: (reason: string) => void | Promise<void>;
}

export interface LinkMessage {
  type: "link";
  pid1: ProcessId;
  pid2: ProcessId;
}

export interface UnlinkMessage {
  type: "unlink";
  pid1: ProcessId;
  pid2: ProcessId;
}

export interface MonitorMessage {
  type: "monitor";
  ref: string;
  fromPid: ProcessId;
  toPid: ProcessId;
}

export interface DemonitorMessage {
  type: "demonitor";
  ref: string;
  fromPid: ProcessId;
  toPid: ProcessId;
}

export interface ExitMessage {
  type: "exit";
  fromPid: ProcessId;
  toPid: ProcessId;
  reason: string;
}

export interface DownMessage {
  type: "down";
  ref: string;
  toPid: ProcessId;
  fromPid: ProcessId;
  reason: string;
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

export interface TaskSpec<T = Message> {
  payload: T;
  timeout?: number;
  retries?: number;
  priority?: number;
}

export interface WorkerSpec {
  handler: (task: Task) => Promise<Message>;
  maxConcurrency?: number;
}

export interface TaskResult {
  taskId: TaskId;
  success: boolean;
  result?: Message;
  error?: string;
  completedAt: number;
}

export interface ReconnectConfig {
  maxRetries?: number;
  maxDelay?: number;
  initialDelay?: number;
}

export interface AuthConfig {
  secret?: string;
  tls?: TLSConfig;
}

export interface TLSConfig {
  cert: string;
  key: string;
  ca?: string;
  rejectUnauthorized?: boolean;
}
