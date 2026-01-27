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
