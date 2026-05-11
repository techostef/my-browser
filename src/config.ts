// ─── Feature flags ────────────────────────────────────────────────────────────
// Set ENABLE_AI_CAPTIONS=false to hide the "Generate caption (AI)" option that
// requires an OpenAI API key and network access.
export const ENABLE_AI_CAPTIONS: boolean =
  process.env.EXPO_PUBLIC_ENABLE_AI_CAPTIONS !== 'false';
