import { FRAME_HEADER_SIZE, MAX_FRAME_SIZE } from "./protocol.ts";

export class FrameReader {
  private buffer = new Uint8Array(0);
  private expectedLength = 0;
  private readingHeader = true;

  append(data: Uint8Array): void {
    const newBuffer = new Uint8Array(this.buffer.length + data.length);
    newBuffer.set(this.buffer);
    newBuffer.set(data, this.buffer.length);
    this.buffer = newBuffer;
  }

  readFrame(): Uint8Array | null {
    if (this.readingHeader) {
      if (this.buffer.length < FRAME_HEADER_SIZE) {
        return null;
      }

      const view = new DataView(this.buffer.buffer);
      this.expectedLength = view.getUint32(0, false);
      
      if (this.expectedLength > MAX_FRAME_SIZE) {
        throw new Error(`Frame size ${this.expectedLength} exceeds maximum ${MAX_FRAME_SIZE}`);
      }

      this.readingHeader = false;
    }

    const totalNeeded = FRAME_HEADER_SIZE + this.expectedLength;
    if (this.buffer.length < totalNeeded) {
      return null;
    }

    const frame = this.buffer.slice(0, totalNeeded);
    this.buffer = this.buffer.slice(totalNeeded);
    this.readingHeader = true;
    this.expectedLength = 0;

    return frame;
  }

  clear(): void {
    this.buffer = new Uint8Array(0);
    this.expectedLength = 0;
    this.readingHeader = true;
  }
}
