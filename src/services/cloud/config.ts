/**
 * Supabase connection for the optional cloud backup.
 * Only the PUBLISHABLE key belongs in the browser; it grants nothing on its own — every table
 * is protected by RLS and requires a signed-in user. Never put a service_role / secret key here.
 * Override at build time: SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... npm run build
 */
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_KEY__: string;

export const SUPABASE_URL: string = typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '';
export const SUPABASE_KEY: string = typeof __SUPABASE_KEY__ !== 'undefined' ? __SUPABASE_KEY__ : '';
export const ASSET_BUCKET = 'book-assets';
export const MAX_CLOUD_ASSET_BYTES = 15 * 1024 * 1024;
export const CLOUD_MIME = /^(image\/(png|jpeg|webp|gif)|audio\/(mpeg|mp4|ogg|wav|webm|aac))$/;

export const cloudConfigured = () => !!SUPABASE_URL && !!SUPABASE_KEY;
