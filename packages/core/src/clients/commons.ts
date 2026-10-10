import { fetchJson } from './http';

const API = 'https://commons.wikimedia.org/w/api.php';

export const NAC_COMMONS_CATEGORY = 'Category:Images from Narodowe Archiwum Cyfrowe';

type ExtMeta = Record<string, { value?: string } | undefined>;
type CommonsPage = {
  pageid: number;
  title: string;
  imageinfo?: Array<{ url: string; thumburl?: string; width: number; height: number; descriptionurl: string; extmetadata?: ExtMeta }>;
  coordinates?: Array<{ lat: number; lon: number }>;
};
type QueryResponse = { query?: { pages?: CommonsPage[] }; continue?: Record<string, string> };

export type CommonsPhoto = {
  title: string;
  description: string | null;
  dateText: string | null;
  author: string | null;
  license: string | null;
  url: string;
  thumbUrl: string | null;
  width: number;
  height: number;
  pageUrl: string;
  nacSignature: string | null;
  lat: number | null;
  lon: number | null;
};

const stripHtml = (s: string | undefined) =>
  s ? s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() || null : null;

/** NAC signatures look like "1-K-1234", "2-211", "3/1/0/17/12796" – Commons keeps them in parentheses in the file name. */
export function nacSignatureFromTitle(title: string): string | null {
  const m = title.match(/\((\d+(?:-[A-Z])?(?:-\d+)+(?:-\d+)?)\)\.\w+$/) ?? title.match(/\(([0-9]+-[0-9A-Z-]+)\)/);
  return m?.[1] ?? null;
}

function toPhoto(p: CommonsPage): CommonsPhoto | null {
  const ii = p.imageinfo?.[0];
  if (!ii) return null;
  const md = ii.extmetadata ?? {};
  return {
    title: p.title,
    description: stripHtml(md.ImageDescription?.value),
    dateText: stripHtml(md.DateTimeOriginal?.value)?.slice(0, 80) ?? null,
    author: stripHtml(md.Artist?.value),
    license: stripHtml(md.LicenseShortName?.value),
    url: ii.url,
    thumbUrl: ii.thumburl ?? null,
    width: ii.width,
    height: ii.height,
    pageUrl: ii.descriptionurl,
    nacSignature: nacSignatureFromTitle(p.title),
    lat: p.coordinates?.[0]?.lat ?? null,
    lon: p.coordinates?.[0]?.lon ?? null,
  };
}

const baseParams = {
  action: 'query',
  format: 'json',
  formatversion: '2',
  prop: 'imageinfo|coordinates',
  iiprop: 'url|size|extmetadata',
  iiurlwidth: '2048',
  iiextmetadatafilter: 'ImageDescription|DateTimeOriginal|Artist|LicenseShortName',
  maxlag: '5',
};

/** Full-text search inside a category (CirrusSearch), e.g. NAC mirror + "Wrocław". */
export async function* searchCommonsFiles(search: string, max = 500): AsyncGenerator<CommonsPhoto> {
  let cont: Record<string, string> = {};
  let n = 0;
  while (n < max) {
    const params = new URLSearchParams({
      ...baseParams,
      generator: 'search',
      gsrsearch: search,
      gsrnamespace: '6',
      gsrlimit: '50',
      ...cont,
    });
    const res = await fetchJson<QueryResponse>(`${API}?${params}`);
    for (const page of res.query?.pages ?? []) {
      const photo = toPhoto(page);
      if (photo) {
        n++;
        yield photo;
      }
    }
    if (!res.continue) break;
    cont = res.continue;
    await new Promise((r) => setTimeout(r, 1000)); // be polite: Commons answered 429 during research
  }
}

/** Files of a category (non-recursive). */
export async function* categoryFiles(category: string, max = 500): AsyncGenerator<CommonsPhoto> {
  let cont: Record<string, string> = {};
  let n = 0;
  while (n < max) {
    const params = new URLSearchParams({
      ...baseParams,
      generator: 'categorymembers',
      gcmtitle: category,
      gcmtype: 'file',
      gcmlimit: '50',
      ...cont,
    });
    const res = await fetchJson<QueryResponse>(`${API}?${params}`);
    for (const page of res.query?.pages ?? []) {
      const photo = toPhoto(page);
      if (photo) {
        n++;
        yield photo;
      }
    }
    if (!res.continue) break;
    cont = res.continue;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function subcategories(category: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    list: 'categorymembers',
    cmtitle: category,
    cmtype: 'subcat',
    cmlimit: '200',
  });
  const res = await fetchJson<{ query?: { categorymembers?: Array<{ title: string }> } }>(`${API}?${params}`);
  return res.query?.categorymembers?.map((c) => c.title) ?? [];
}
