export interface FakeSupabase {
  handle(method: string, url: string, headers: Record<string, string>, body: Uint8Array | null): Promise<{ status: number; headers: Record<string, string>; body: string | Uint8Array }>;
  fetch: typeof fetch;
  log: string[];
  sentFiles: string[];
  aiCalls: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wipeRequests: any[];
  setWipeTtl(ms: number): void;
  setOnline(v: boolean): void;
  confirm(email: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: { users: Map<string, any>; books: any[]; chapters: any[]; assets: any[]; objects: Map<string, any>; sync: any[]; subscribers: any[]; broadcasts: any[]; announcements: any[]; feedback: any[]; events: any[]; audit: any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  botMessages: any[];
  blockingIds: Set<number>;
}
export function createFakeSupabase(opts?: { requireConfirmation?: boolean; aiConfigured?: boolean; wipeTtlMs?: number; wipeReady?: boolean; adminTelegramIds?: number[]; adminReady?: boolean; broadcastPerRun?: number }): FakeSupabase;
