/**
 * AI provider registry.
 *
 * Phase 2: implement `TextAIProvider` / `ImageAIProvider` with calls to a server endpoint
 * (Supabase Edge Function holding the API key) and register them here. No screen changes needed.
 */
import { DemoTextAIProvider } from './demoText';
import { DemoImageAIProvider } from './demoImage';
import type { ImageAIProvider, TextAIProvider } from './types';

let textProvider: TextAIProvider = new DemoTextAIProvider();
let imageProvider: ImageAIProvider = new DemoImageAIProvider();

export const getTextAI = () => textProvider;
export const getImageAI = () => imageProvider;
export function setTextProvider(p: TextAIProvider) { textProvider = p; }
export function setImageProvider(p: ImageAIProvider) { imageProvider = p; }

// Test hook: `?fastAI=1` removes simulated latency (used by automated browser tests).
if (typeof location !== 'undefined' && /[?&]fastAI=1/.test(location.search)) {
  textProvider = new DemoTextAIProvider(0);
  imageProvider = new DemoImageAIProvider(0);
}

export * from './types';
