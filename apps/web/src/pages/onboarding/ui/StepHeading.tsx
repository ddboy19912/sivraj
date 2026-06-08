type StepHeadingProps = {
  eyebrow: string;
  title: string;
  body: string;
};

export function StepHeading({ eyebrow, title, body }: StepHeadingProps) {
  return (
    <header className="grid gap-2">
      <p className="font-mono text-xs font-semibold uppercase tracking-widest text-[rgba(var(--theme-color-rgb),0.86)]">
        {eyebrow}
      </p>
      <h1 className="text-balance text-2xl font-semibold leading-tight text-white font-sora">
        {title}
      </h1>
      <p className="text-pretty text-sm leading-6 text-white/64">{body}</p>
    </header>
  );
}
