import type { APIRoute } from 'astro';
import { getLodgingCapacityStatus } from '@lib/cumbreLodgingCapacity';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const status = await getLodgingCapacityStatus();
    return new Response(JSON.stringify({ ok: true, ...status }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[cumbre.lodging.status] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo consultar disponibilidad de hospedaje' }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  }
};
