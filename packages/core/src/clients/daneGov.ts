import { fetchJson } from './http';

/** dane.gov.pl dataset "Rejestr zabytków nieruchomych" (NID). */
export const REGISTRY_DATASET_ID = 1130;
const API = 'https://api.dane.gov.pl/1.4';

type ResourceListResponse = {
  data: Array<{
    id: string;
    attributes: { title: string; format: string | null; link: string | null; modified: string | null };
  }>;
};

export type RegistryResource = { resourceId: string; title: string; url: string; modified: string | null };

/**
 * Discovers the live NID REST endpoint through the dane.gov.pl catalogue instead of hard-coding it,
 * so a URL change on the publisher side is picked up automatically.
 */
export async function discoverRegistryResource(datasetId = REGISTRY_DATASET_ID): Promise<RegistryResource> {
  const res = await fetchJson<ResourceListResponse>(`${API}/datasets/${datasetId}/resources?per_page=50`);
  const api = res.data.find((r) => r.attributes.link?.includes('api.zabytek.gov.pl'));
  if (!api?.attributes.link) throw new Error(`dataset ${datasetId}: no api.zabytek.gov.pl resource`);
  return {
    resourceId: api.id,
    title: api.attributes.title,
    url: api.attributes.link,
    modified: api.attributes.modified,
  };
}
