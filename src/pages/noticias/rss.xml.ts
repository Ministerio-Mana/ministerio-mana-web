import type { APIRoute } from 'astro';
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async (ctx) => {
  const posts = (await getCollection('news')).sort((a,b)=> new Date(b.data.date)-new Date(a.data.date));
  return rss({
    title: 'Ministerio Maná — Noticias',
    description: 'Noticias e historias de fe',
    site: ctx.site!.href,
    items: posts.map(p => ({
      link: `/noticias/${p.id}/`,
      title: p.data.title,
      pubDate: new Date(p.data.date),
      description: p.data.summary,
    }))
  });
};
