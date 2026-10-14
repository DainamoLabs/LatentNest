import { useEffect, useState, type ReactNode } from 'react';
import { batchTiming } from '@/lib/batch';
import type { BatchJob } from '@/lib/db';

/** The run's time estimate, redrawn every second so it counts down without redrawing the page around it. */
export function TimeLeft({ job, children }: { job: BatchJob; children: (timing: ReturnType<typeof batchTiming>) => ReactNode }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return children(batchTiming(job));
}
