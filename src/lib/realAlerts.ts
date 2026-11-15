import { livePointsForRegion } from './data';
import type { LiveFire, Region } from './types';

export const HIGH_FRP_MW = 50;

export interface FireAlert {
  id: string;
  region: Region;
  date: string;
  points: number;
  peakFrp: number;
  totalFrp: number;
}

/** Actual detection tuples only; no reconstructed daily record enters this list. */
export function highFrpAlerts(fires: LiveFire[], regions: Region[], start: string, end: string): FireAlert[] {
  const alerts: FireAlert[] = [];
  for (const region of new Map(regions.map(r => [r.id, r])).values()) {
    const byDay = new Map<string, FireAlert>();
    for (const fire of livePointsForRegion(region, fires)) {
      if (!Number.isFinite(fire[2]) || fire[2] < HIGH_FRP_MW || !Number.isFinite(fire[5])) continue;
      const date = new Date(fire[5] * 1000).toISOString().slice(0, 10);
      if (date < start || date > end) continue;
      const alert = byDay.get(date) ?? { id: `${region.id}:${date}`, region, date, points: 0, peakFrp: 0, totalFrp: 0 };
      alert.points++;
      alert.peakFrp = Math.max(alert.peakFrp, fire[2]);
      alert.totalFrp += fire[2];
      byDay.set(date, alert);
    }
    alerts.push(...byDay.values());
  }
  return alerts.sort((a, b) => b.date.localeCompare(a.date) || b.peakFrp - a.peakFrp);
}

export interface CommunityAlert {
  id: string;
  content: string;
  author: string;
  createdAt: string;
}

export function verifiedCommunityAlerts(feed: any): CommunityAlert[] {
  if (!Array.isArray(feed?.posts)) throw new Error('Community feed returned invalid data.');
  return feed.posts.filter((post: any) => post.verified === true && (post.type === 'anomaly' || post.isAnomaly === true) &&
    typeof post.id === 'string' && typeof post.content === 'string' && typeof post.author === 'string' &&
    typeof post.createdAt === 'string' && Number.isFinite(Date.parse(post.createdAt)))
    .map(({ id, content, author, createdAt }: CommunityAlert) => ({ id, content, author, createdAt }))
    .sort((a: CommunityAlert, b: CommunityAlert) => b.createdAt.localeCompare(a.createdAt));
}
