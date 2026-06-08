type NavbarBrandProps = {
  color: string;
};

export function NavbarBrand({ color }: NavbarBrandProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        style={{ backgroundColor: color }}
        className="size-4 shrink-0 rounded-full"
      />
      <h1
        style={{ color }}
        className="text-sm font-mono uppercase font-bold tracking-[1.2px] leading-none"
      >
        Sivraj_OS_V1.0
      </h1>
    </div>
  );
}
