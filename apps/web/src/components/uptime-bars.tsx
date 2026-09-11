import type { UptimeBucket } from '@/lib/queries/routers';
import { Tooltip } from './ui/overlays';

export interface UptimeSeries {
  /** One slot per bucket, oldest first; null = no samples in that window. */
  slots: Array<{ start: Date; samples: number; reachable: number } | null>;
  /** Overall reachable fraction (0–1) over the window, or null with no samples. */
  ratio: number | null;
}

/**
 * Bucket the uptime rows for one router into a fixed 7-day grid, so every
 * router's strip lines up in the table and gaps (no polls) stay visible.
 */
export function buildUptimeSeries(rows: UptimeBucket[], routerId: string, now: Date, days = 7, bucketHours = 6): UptimeSeries {
  const bucketMs = bucketHours * 3_600_000;
  const count = Math.round((days * 24) / bucketHours);
  const lastStart = Math.floor(now.getTime() / bucketMs) * bucketMs;
  const firstStart = lastStart - (count - 1) * bucketMs;
  const slots: UptimeSeries['slots'] = Array.from({ length: count }, () => null);
  let samples = 0;
  let reachable = 0;
  for (const r of rows) {
    if (r.router_id !== routerId) continue;
    const idx = Math.round((Date.parse(r.bucket_start) - firstStart) / bucketMs);
    if (idx < 0 || idx >= count) continue;
    slots[idx] = { start: new Date(firstStart + idx * bucketMs), samples: r.samples, reachable: r.reachable_samples };
    samples += r.samples;
    reachable += r.reachable_samples;
  }
  return { slots, ratio: samples > 0 ? reachable / samples : null };
}

const fmtTime = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * 7-day uptime strip: one thin bar per 6-hour window, height = share of health
 * polls that reached the router. Single series, single accent hue; empty
 * windows are a baseline tick. Each bar has a hover tooltip; the overall
 * figure is printed as text beside it (never color alone).
 */
export function UptimeBars({ series, label }: { series: UptimeSeries; label: string }) {
  const H = 20;
  const W = 3;
  const GAP = 1;
  const width = series.slots.length * (W + GAP) - GAP;
  const pct = series.ratio === null ? null : Math.round(series.ratio * 1000) / 10;
  return (
    <div className="flex items-center gap-2">
      <div
        role="img"
        aria-label={pct === null ? `${label}: no uptime data yet` : `${label}: ${pct}% uptime over 7 days`}
        className="flex h-5 items-end"
        style={{ width, gap: GAP }}
      >
        {series.slots.map((slot, i) => {
          const ratio = slot && slot.samples > 0 ? slot.reachable / slot.samples : null;
          const h = ratio === null ? 2 : Math.max(2, Math.round(ratio * H));
          const tip = slot
            ? `${fmtTime(slot.start)} · ${Math.round((ratio ?? 0) * 100)}% reachable (${slot.reachable}/${slot.samples} polls)`
            : 'No polls in this window';
          return (
            <Tooltip key={i} content={tip}>
              {/* Hit target is the full column height, larger than the mark itself. */}
              <span className="flex h-full cursor-default items-end" style={{ width: W }} tabIndex={-1}>
                <span
                  className={
                    ratio === null
                      ? 'block w-full rounded-[1px] bg-viz-empty'
                      : ratio === 0
                        ? // Fully down: a baseline tick in the reserved "critical" state color (the tooltip says "0% reachable").
                          'block w-full rounded-[1px] bg-status-critical'
                        : 'block w-full rounded-t-[1px] bg-viz-accent'
                  }
                  style={{ height: ratio === 0 ? 3 : h }}
                />
              </span>
            </Tooltip>
          );
        })}
      </div>
      <span className="w-12 text-right text-xs tabular text-muted-foreground">{pct === null ? '—' : `${pct}%`}</span>
    </div>
  );
}
