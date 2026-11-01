// A cropped photo that honours the saved focus point and zoom (plan §7.6.1).
import type { CSSProperties } from 'react';

export interface PhotoSource {
  src: string;
  thumb?: string | null;
  width?: number | null;
  height?: number | null;
  focalX: number;
  focalY: number;
  zoom: number;
}

export function photoStyle(p: Pick<PhotoSource, 'focalX' | 'focalY' | 'zoom'>): CSSProperties {
  const pos = `${(p.focalX * 100).toFixed(1)}% ${(p.focalY * 100).toFixed(1)}%`;
  return {
    objectPosition: pos,
    transformOrigin: pos,
    transform: p.zoom > 1 ? `scale(${p.zoom})` : undefined,
  };
}

export function Photo({
  photo,
  alt,
  sizes,
  className,
  eager,
}: {
  photo: PhotoSource;
  alt: string;
  sizes: string;
  className?: string;
  eager?: boolean;
}) {
  const srcSet = photo.thumb && photo.thumb !== photo.src ? `${photo.thumb} 240w, ${photo.src} 720w` : undefined;
  return (
    <img
      className={className}
      src={photo.src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      width={photo.width ?? 720}
      height={photo.height ?? 960}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      style={photoStyle(photo)}
    />
  );
}
