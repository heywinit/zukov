export enum MessageType {
  Spawn = 0x01,
  Send = 0x02,
  Link = 0x03,
  Monitor = 0x04,
  Exit = 0x05,
  Ping = 0x06,
  Pong = 0x07,
  NodeInfo = 0x08,
}

export interface ProtocolMessage {
  type: MessageType;
  payload: Uint8Array;
}

export interface SpawnMessage {
  type: MessageType.Spawn;
  spec: unknown;
  fromPid: string;
}

export interface SendMessage {
  type: MessageType.Send;
  to: string;
  from: string;
  message: unknown;
}

export interface ExitMessage {
  type: MessageType.Exit;
  pid: string;
  reason: string;
}

export const FRAME_HEADER_SIZE = 5; // 4 bytes length + 1 byte type
export const MAX_FRAME_SIZE = 1024 * 1024 * 10; // 10MB max frame
