import { createHmac, randomBytes } from "node:crypto";

export function generateNonce(): string {
  return randomBytes(32).toString("hex");
}

export function createAuthSignature(nodeId: string, nonce: string, secret: string): string {
  const data = `${nodeId}:${nonce}`;
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function verifyAuthSignature(
  nodeId: string,
  nonce: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createAuthSignature(nodeId, nonce, secret);
  return expected === signature;
}

export interface AuthState {
  nodeId: string;
  nonce?: string;
  authenticated: boolean;
  isServer: boolean;
}

export function createAuthState(nodeId: string, isServer: boolean): AuthState {
  return {
    nodeId,
    nonce: isServer ? generateNonce() : undefined,
    authenticated: false,
    isServer,
  };
}
