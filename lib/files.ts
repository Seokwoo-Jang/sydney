// File rules and browser-side photo variants (plan §7.4 C, §7.6.1, §8.3).
// Originals are kept as uploaded; screens use a 2048 px display copy and a
// 480 px thumbnail made here, so the original is downloaded only on request.
import { S } from './strings';

export const DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DOC_MAX_MB = 10;
export const PHOTO_MAX_MB = 20;
export const DISPLAY_EDGE = 2048;
export const THUMB_EDGE = 480;

const MB = 1024 * 1024;

export type FileKind = 'document' | 'photo';

/** null when the file can be stored, else the message to show. */
export function fileProblem(file: Pick<File, 'type' | 'size'>, kind: FileKind): string | null {
  const types: readonly string[] = kind === 'document' ? DOC_MIME : PHOTO_MIME;
  if (!types.includes(file.type)) return kind === 'document' ? S.files.wrongType : S.files.wrongPhotoType;
  const max = kind === 'document' ? DOC_MAX_MB : PHOTO_MAX_MB;
  if (file.size > max * MB) return S.files.tooLarge(max);
  return null;
}

/** Long edge scaled down to `edge` (never up). */
export function fitWithin(width: number, height: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface PhotoVariants {
  width: number;
  height: number;
  display: Blob;
  thumb: Blob;
  /** Type of the generated copies (WebP when the browser can encode it). */
  variantType: 'image/webp' | 'image/jpeg';
}

async function encode(bitmap: ImageBitmap, edge: number): Promise<{ blob: Blob; type: PhotoVariants['variantType'] }> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, edge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, width, height);
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await toBlob('image/webp');
  if (webp && webp.type === 'image/webp') return { blob: webp, type: 'image/webp' };
  const jpeg = await toBlob('image/jpeg');
  if (!jpeg) throw new Error('encode');
  return { blob: jpeg, type: 'image/jpeg' };
}

/** Reads the photo (EXIF orientation applied) and makes the display copy and thumbnail. */
export async function makePhotoVariants(file: Blob): Promise<PhotoVariants> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const display = await encode(bitmap, DISPLAY_EDGE);
    const thumb = await encode(bitmap, THUMB_EDGE);
    return { width: bitmap.width, height: bitmap.height, display: display.blob, thumb: thumb.blob, variantType: display.type };
  } finally {
    bitmap.close();
  }
}

/** '.webp' / '.jpg' for a generated copy. */
export const variantExt = (type: PhotoVariants['variantType']) => (type === 'image/webp' ? 'webp' : 'jpg');
