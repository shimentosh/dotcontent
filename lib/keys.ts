/**
 * The catalogue of services a pack can spend a key on — video, image, music,
 * search. These are deliberately NOT the brain: the brain is a model on the
 * Integrations page, and these buy the things a model cannot make itself.
 *
 * The keys themselves are NOT here. They used to be, in a Map in the browser,
 * which meant the server — the only thing that could ever spend one — never
 * saw a key. They are rows now, encrypted at rest, reachable only through
 * `/api/settings/keys`. This file is the list of what can be given one.
 */

export type KeyGroup = "Video" | "Image" | "Audio" | "Research";

export type KeyProvider = {
  id: string;
  name: string;
  group: KeyGroup;
  /** What a pack would spend this key on. */
  use: string;
  /** The shape of a real key, so a typo is obvious. */
  hint: string;
};

export const KEY_GROUP_ORDER: KeyGroup[] = [
  "Video",
  "Image",
  "Audio",
  "Research",
];

export const KEY_PROVIDERS: KeyProvider[] = [
  {
    id: "runway",
    name: "Runway",
    group: "Video",
    use: "Turns a shot plan into b-roll clips",
    hint: "key_…",
  },
  {
    id: "luma",
    name: "Luma",
    group: "Video",
    use: "Image-to-video for title cards and transitions",
    hint: "luma-…",
  },
  {
    id: "fal",
    name: "fal.ai",
    group: "Image",
    use: "Thumbnails and on-screen graphics, fast",
    hint: "fal-…",
  },
  {
    id: "replicate",
    name: "Replicate",
    group: "Image",
    use: "Any open image model, when fal does not have it",
    hint: "r8_…",
  },
  {
    id: "suno",
    name: "Suno",
    group: "Audio",
    use: "Background music beds under narration",
    hint: "suno-…",
  },
  {
    id: "serper",
    name: "Serper",
    group: "Research",
    use: "Live search results for Topic research",
    hint: "…32 chars",
  },
];

export const providersIn = (group: KeyGroup) =>
  KEY_PROVIDERS.filter((p) => p.group === group);
