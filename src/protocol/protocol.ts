export enum MessageType {
  Spawn = 0x01,
  Send = 0x02,
  Link = 0x03,
  Monitor = 0x04,
  Exit = 0x05,
  Ping = 0x06,
  Pong = 0x07,
  NodeInfo = 0x08,
  Down = 0x09,
  AuthChallenge = 0x10,
  AuthResponse = 0x11,
  AuthAck = 0x12,
  AuthReject = 0x13,
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
  fromPid: string;
  toPid: string;
  reason: string;
}

export interface DownMessage {
  type: MessageType.Down;
  ref: string;
  fromPid: string;
  toPid: string;
  reason: string;
}

export interface AuthChallengeMessage {
  type: MessageType.AuthChallenge;
  nodeId: string;
  nonce: string;
}

export interface AuthResponseMessage {
  type: MessageType.AuthResponse;
  nodeId: string;
  signature: string;
}

export interface AuthAckMessage {
  type: MessageType.AuthAck;
  nodeId: string;
}

export interface AuthRejectMessage {
  type: MessageType.AuthReject;
  reason: string;
}

export const FRAME_HEADER_SIZE = 5; // 4 bytes length + 1 byte type
export const MAX_FRAME_SIZE = 1024 * 1024 * 10; // 10MB max frame
