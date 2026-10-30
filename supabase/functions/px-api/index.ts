// @ts-nocheck — Edge Function "px-api": toda a API da PX Monitorias & Feedbacks dentro do Supabase.
// URL: https://<projeto>.supabase.co/functions/v1/px-api/<rota>
// No servidor próprio (sem Supabase), a mesma API é servida por servidor/main.ts.
import { handleApi } from './api.ts';

Deno.serve((request) => handleApi(request, '/px-api'));
