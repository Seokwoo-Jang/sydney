import { describe, expect, it } from 'vitest';
import { fileProblem, fitWithin } from '@/lib/files';
import { S } from '@/lib/strings';

const MB = 1024 * 1024;

describe('file rules', () => {
  it('accepts the plan types and sizes per kind', () => {
    expect(fileProblem({ type: 'application/pdf', size: 10 * MB }, 'document')).toBeNull();
    expect(fileProblem({ type: 'application/pdf', size: 10 * MB + 1 }, 'document')).toBe(S.files.tooLarge(10));
    expect(fileProblem({ type: 'image/heic', size: 1 }, 'document')).toBe(S.files.wrongType);
    expect(fileProblem({ type: 'application/pdf', size: 1 }, 'photo')).toBe(S.files.wrongPhotoType);
    expect(fileProblem({ type: 'image/webp', size: 20 * MB }, 'photo')).toBeNull();
    expect(fileProblem({ type: 'image/jpeg', size: 20 * MB + 1 }, 'photo')).toBe(S.files.tooLarge(20));
  });

  it('scales the long edge down, never up', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, 480)).toEqual({ width: 360, height: 480 });
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });
});
