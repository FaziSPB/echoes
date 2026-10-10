import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const reserve = vi.fn();
const release = vi.fn();

vi.mock('@google/genai', () => ({ GoogleGenAI: class { interactions = { create } } }));
vi.mock('../budget', () => ({ reserveImageGeneration: reserve, releaseImageGeneration: release }));
vi.mock('../env', () => ({ env: { GEMINI_API_KEY: 'test-key', GEMINI_IMAGE_MODEL: 'test-model' } }));

const { editImage, GeminiBillingError } = await import('./gemini');

const request = { prompt: 'p', images: [], aspectRatio: '4:1' as const, imageSize: '1K' as const };
const apiError = (status: number) => Object.assign(new Error(`${status} status code (no body)`), { status });

describe('editImage budget reservation', () => {
  beforeEach(() => {
    create.mockReset();
    reserve.mockReset().mockResolvedValue(undefined);
    release.mockReset().mockResolvedValue(undefined);
  });

  it('keeps the reservation when an image is returned', async () => {
    create.mockResolvedValue({ output_image: { data: Buffer.from('jpg').toString('base64') } });
    await expect(editImage(request)).resolves.toEqual(Buffer.from('jpg'));
    expect(reserve).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });

  it.each([400, 429, 500, 503])('releases the reservation when the API answers %i', async (status) => {
    const err = apiError(status);
    create.mockRejectedValue(err);
    await expect(editImage(request)).rejects.toBe(err);
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases the reservation and reports billing on 402', async () => {
    create.mockRejectedValue(apiError(402));
    const err = await editImage(request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeminiBillingError);
    expect((err as Error).message).toMatch(/402.*Billing/);
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps the reservation on a timeout, which may still be billed', async () => {
    const err = Object.assign(new Error('Request timed out.'), { status: undefined });
    create.mockRejectedValue(err);
    await expect(editImage(request)).rejects.toBe(err);
    expect(release).not.toHaveBeenCalled();
  });

  it('never sends a request the budget did not allow', async () => {
    reserve.mockRejectedValue(new Error('limit'));
    await expect(editImage(request)).rejects.toThrow('limit');
    expect(create).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
});
