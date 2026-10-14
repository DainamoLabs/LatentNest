/** Simplified LatentNest mark: the logo's bird as a solid silhouette (see scripts/make-mark.py). */
export function Mark({ size = 26 }: { size?: number }) {
  return <img src="/mark.png" alt="" width={size} height={size} />;
}

export function BrandTile() {
  return (
    <span className="brand-tile">
      <Mark />
    </span>
  );
}
