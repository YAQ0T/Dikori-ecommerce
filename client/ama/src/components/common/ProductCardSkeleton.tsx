const ProductCardSkeleton = () => (
  <div className="surface-card p-3 text-right animate-pulse">
    <div className="w-full aspect-[3/4] rounded-lg bg-muted/60" />
    <div className="mt-3 h-4 w-3/4 rounded bg-muted/60" />
    <div className="mt-2 h-3 w-1/3 rounded bg-muted/60" />
    <div className="mt-3 h-9 w-full rounded bg-muted/60" />
  </div>
);

export default ProductCardSkeleton;
