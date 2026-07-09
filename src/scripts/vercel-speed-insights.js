import { injectSpeedInsights } from '@vercel/speed-insights';

function normalizeRoute() {
    const pathname = window.location.pathname || '/';
    if (pathname.startsWith('/portal')) return pathname;
    return pathname.replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/[id]');
}

injectSpeedInsights({
    route: normalizeRoute(),
    debug: false,
    beforeSend: (event) => {
        try {
            const url = new URL(event.url);
            url.search = '';
            url.hash = '';
            event.url = url.toString();
        } catch {
            // Keep the original event if Vercel changes the event shape.
        }
        return event;
    },
});
