export interface FakeSupabase {
  handle(method: string, url: string, headers: Record<string, string>, body: Uint8Array | null): Promise<{ status: number; headers: Record<string, string>; body: string | Uint8Array }>;
  fetch: typeof fetch;
  log: string[];
  sentFiles: string[];
  setOnline(v: boolean): void;
  confirm(email: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: { users: Map<string, any>; books: any[]; chapters: any[]; assets: any[]; objects: Map<string, any>; sync: any[] };
}
export function createFakeSupabase(opts?: { requireConfirmation?: boolean }): FakeSupabase;
