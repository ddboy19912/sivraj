import * as React from "react";

import { liquidGlassDense } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";

const inputClassName = cn(
  liquidGlassDense,
  "h-12 w-full min-w-0 appearance-none rounded-2xl px-4 py-2 text-base text-white [color-scheme:dark] outline-none transition placeholder:text-white/38 focus-visible:border-[rgba(var(--theme-color-rgb),0.58)] focus-visible:ring-4 focus-visible:ring-[rgba(var(--theme-color-rgb),0.14)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-300/60 aria-invalid:ring-4 aria-invalid:ring-red-400/16",
);

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        inputClassName,
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-white md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
