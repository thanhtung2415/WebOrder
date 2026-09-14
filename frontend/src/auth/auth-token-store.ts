let currentAccessToken: string | null = null;

export function setCurrentAccessToken(accessToken: string | null): void {
  currentAccessToken = accessToken;
}

export function getCurrentAccessToken(): string | null {
  return currentAccessToken;
}
