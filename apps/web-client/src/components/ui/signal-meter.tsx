import * as Progress from "@radix-ui/react-progress";

import { cn } from "../../lib/cn.js";

export function SignalMeter({
  className,
  label,
  value,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  const clampedValue = Math.max(0, Math.min(100, value));

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        <span>{clampedValue}%</span>
      </div>
      <Progress.Root
        aria-label={label}
        className="relative h-3 overflow-hidden rounded-full bg-secondary/70"
        max={100}
        value={clampedValue}
      >
        <Progress.Indicator
          className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary))_0%,#10B981_55%,#F59E0B_100%)] transition-transform duration-200"
          style={{ transform: `translateX(-${100 - clampedValue}%)` }}
        />
      </Progress.Root>
    </div>
  );
}
