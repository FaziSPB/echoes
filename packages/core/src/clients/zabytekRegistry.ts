import { z } from 'zod';
import { fetchJson } from './http';

const RawRecord = z.object({
  inspireId: z.string(),
  formaOchrony: z.string().nullish(),
  dokladnoscPolozenia: z.string().nullish(),
  nazwa: z.string(),
  chronologia: z.string().nullish(),
  funkcja: z.string().nullish(),
  wykazDokumentow: z.string().nullish(),
  dataWpisu: z.string().nullish(),
  wojewodztwo: z.string().nullish(),
  powiat: z.string().nullish(),
  gmina: z.string().nullish(),
  miejscowosc: z.string().nullish(),
  ulica: z.string().nullish(),
  nrAdresowy: z.string().nullish(),
});
export type RawRegistryRecord = z.infer<typeof RawRecord>;

export type MonumentRow = {
  inspireId: string;
  name: string;
  protectionForm: string | null;
  locationPrecision: string | null;
  chronology: string | null;
  function: string | null;
  registryDocs: string | null;
  entryDate: string | null;
  voivodeship: string | null;
  county: string | null;
  commune: string | null;
  city: string | null;
  street: string | null;
  houseNumber: string | null;
  zabytekUrl: string;
};

const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export function mapRegistryRecord(raw: unknown): MonumentRow | null {
  const parsed = RawRecord.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    inspireId: r.inspireId,
    name: r.nazwa.trim(),
    protectionForm: blank(r.formaOchrony),
    locationPrecision: blank(r.dokladnoscPolozenia),
    chronology: blank(r.chronologia),
    function: blank(r.funkcja),
    registryDocs: blank(r.wykazDokumentow),
    entryDate: blank(r.dataWpisu),
    voivodeship: blank(r.wojewodztwo),
    county: blank(r.powiat),
    commune: blank(r.gmina),
    city: blank(r.miejscowosc),
    street: blank(r.ulica),
    houseNumber: blank(r.nrAdresowy),
    zabytekUrl: `https://zabytek.pl/pl/obiekty/zabytek?inspire_id=${encodeURIComponent(r.inspireId)}&rejestr=rejestr-zabytkow`,
  };
}

/** The NID endpoint (ServiceStack) returns the full register (~81k rows, ~34 MB) with ?format=json. */
export async function fetchRegistry(url: string): Promise<MonumentRow[]> {
  const sep = url.includes('?') ? '&' : '?';
  const body = await fetchJson<{ data: unknown[] }>(`${url}${sep}format=json`, { timeoutMs: 180_000 });
  return body.data.map(mapRegistryRecord).filter((r): r is MonumentRow => r !== null);
}
