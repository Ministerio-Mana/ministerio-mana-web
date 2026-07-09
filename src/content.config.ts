import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const events = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
    category: z.enum([
      'peregrinacion',
      'evento',
      'mujeres',
      'campus',
      'devocional',
    ]),
    summary: z.string(),
    location: z.string(),
    heroImage: z.string().optional(),
    brochurePdf: z.string().optional(),
    highlight: z.boolean().optional(),
  }),
});

const news = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
    summary: z.string(),
    image: z.string().optional(),
    category: z.enum(['general', 'testimonio', 'mujeres', 'campus']).optional(),
  }),
});

export const collections = {
  events,
  news,
};
