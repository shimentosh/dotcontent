import { LAUNCH_CAMPAIGN } from "./launch-campaign";
import { NEWSLETTER } from "./newsletter";
import { PRODUCT_REVIEW } from "./product-review";
import { REPURPOSE_VIDEO } from "./repurpose-video";
import { SEO_BLOG_POST } from "./seo-blog-post";
import { SOCIAL_POST_PACK } from "./social-post-pack";
import { WEBSITE_SHORTS, type Pack } from "./website-shorts";

/**
 * Every template that ships with the app.
 *
 * Seeded into the packs table on first run, and on an existing console the
 * first time a release adds one (`seedPacks` records which slugs it has
 * introduced, so a template you delete stays deleted). Each is a different
 * shape of content on purpose: a short-form video set, a long-form article,
 * posts for every platform, a cross-format review, an email, a repurposed
 * recording and a campaign. Together they show what a template can be, and
 * each is a starting point to copy rather than a finished product.
 *
 * The order is the library's order on a fresh console.
 */
export const PACKS: Pack[] = [
  WEBSITE_SHORTS,
  SEO_BLOG_POST,
  SOCIAL_POST_PACK,
  PRODUCT_REVIEW,
  NEWSLETTER,
  REPURPOSE_VIDEO,
  LAUNCH_CAMPAIGN,
];

export const findPack = (slug: string) => PACKS.find((p) => p.slug === slug);
