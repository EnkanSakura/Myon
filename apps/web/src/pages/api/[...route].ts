import { env } from 'cloudflare:workers';
import app from '@myon/back';
import type { AppBindings } from '@myon/back/types';
import type { APIRoute } from 'astro';

export const ALL: APIRoute = ({ request }) =>
  app.fetch(request, env as unknown as AppBindings);
