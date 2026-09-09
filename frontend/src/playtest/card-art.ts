import type { CardPresentation } from './types.js';

/** Art-only rendering never falls back to a printed card (which includes rules text).
 * Scryfall's image variants share the same face/id path. Other providers must supply artUri. */
export function battlefieldArtUri(presentation: CardPresentation | null | undefined): string | null {
  if (presentation?.artUri) return presentation.artUri;
  if (!presentation?.imageUri) return null;
  try {
    const uri = new URL(presentation.imageUri);
    if (uri.hostname !== 'cards.scryfall.io' || !/^\/(normal|large)\/(front|back)\//.test(uri.pathname)) return null;
    uri.pathname = uri.pathname.replace(/^\/(normal|large)\//, '/art_crop/');
    return uri.href;
  } catch { return null; }
}
