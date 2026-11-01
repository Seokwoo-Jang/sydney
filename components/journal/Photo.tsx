// A photo with its size set up front, so its box is held before it loads (no
// layout shift). Journal pages show it whole; Nine Notes cards crop it in CSS.

export interface PhotoSource {
  src: string;
  thumb?: string | null;
  width?: number | null;
  height?: number | null;
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
    />
  );
}
