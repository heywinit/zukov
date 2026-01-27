import { MessageType, type ProtocolMessage, FRAME_HEADER_SIZE } from "./protocol.ts";

export function serializeMessage(type: MessageType, data: unknown): Uint8Array {
  const json = JSON.stringify(data);
  const encoder = new TextEncoder();
  const payload = encoder.encode(json);
  
  const frame = new Uint8Array(FRAME_HEADER_SIZE + payload.length);
  const view = new DataView(frame.buffer);
  
  // Write length (4 bytes, big-endian)
  view.setUint32(0, payload.length, false);
  // Write type (1 byte)
  frame[4] = type;
  // Write payload
  frame.set(payload, FRAME_HEADER_SIZE);
  
  return frame;
}

export function deserializeMessage(frame: Uint8Array): ProtocolMessage | null {
  if (frame.length < FRAME_HEADER_SIZE) {
    return null;
  }

  const view = new DataView(frame.buffer);
  const length = view.getUint32(0, false);
  const type = frame[4] as MessageType;

  if (frame.length < FRAME_HEADER_SIZE + length) {
    return null;
  }

  const payload = frame.slice(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + length);
  const decoder = new TextDecoder();
  const json = decoder.decode(payload);

  try {
    const data = JSON.parse(json);
    return {
      type,
      payload: new Uint8Array(payload),
    };
  } catch {
    return null;
  }
}

export function createFrame(data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(FRAME_HEADER_SIZE + data.length);
  const view = new DataView(frame.buffer);
  
  view.setUint32(0, data.length, false);
  frame.set(data, FRAME_HEADER_SIZE);
  
  return frame;
}
