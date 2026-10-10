import { log } from '../log';

export const USER_AGENT = 'EchoesHackathon/0.1 (BEST Hacks 2026; https://github.com/echoes-app)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FetchOpts = RequestInit & { retries?: number; timeoutMs?: number };

/** fetch with UA, timeout and exponential backoff on 429/5xx (Wikimedia & gov APIs throttle). */
export async function fetchWithRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { retries = 4, timeoutMs = 60_000, headers, ...init } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
        log.warn({ url, status: res.status, wait }, 'retrying request');
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await fetchWithRetry(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as T;
}
