import type { APIRoute } from 'astro';
import {
  cumbreAudienceFilters,
  getPublicScheduleEvents,
  getScheduleIcsText,
} from '@data/cumbreSchedule';

const validTracks = new Set(cumbreAudienceFilters.map((filter) => filter.id));
const validDates = new Set(['2026-06-06', '2026-06-07', '2026-06-08']);

export const GET: APIRoute = ({ url }) => {
  const rawTrack = url.searchParams.get('track') ?? 'all';
  const rawDate = url.searchParams.get('date');
  const track = validTracks.has(rawTrack) ? rawTrack : 'all';
  const date = rawDate && validDates.has(rawDate) ? rawDate : null;
  const events = getPublicScheduleEvents().filter((event) => {
    const trackMatch =
      track === 'all' ||
      event.audience === track ||
      (track !== 'todos' && event.audience === 'todos');
    const dateMatch = !date || event.date === date;

    return trackMatch && dateMatch;
  });

  const trackLabel =
    cumbreAudienceFilters.find((filter) => filter.id === track)?.label ?? 'Todos';
  const calendarName = date
    ? `Cumbre Mundial 2026 - ${trackLabel} - ${date}`
    : `Cumbre Mundial 2026 - ${trackLabel}`;
  const filename = [
    'cumbre-mundial-2026',
    track === 'all' ? 'todos' : track,
    date,
  ]
    .filter(Boolean)
    .join('-');

  return new Response(getScheduleIcsText(events, calendarName, { includeTeamNotes: false }), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.ics"`,
      'Cache-Control': 'public, max-age=300',
    },
  });
};
