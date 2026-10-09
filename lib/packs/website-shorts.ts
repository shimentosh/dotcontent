/**
 * The Website Shorts pack — the template that ships.
 *
 * One website in, a whole short-form package out: an English and a Bangla
 * script, on-screen captions, spoken hooks, social captions, hashtags and
 * YouTube SEO. The rules, the twelve sections, their dependency arrows and
 * every instruction were tuned against real output, which is why they are long:
 * read it as a worked example of what a template can say, then copy it and
 * write your own in the builder.
 *
 * The slug still reads `enbn-website-package`, from before the rename. It is
 * the row's id in every database this has already been seeded into, and the
 * runs written under it point at it; a new slug would seed a second copy
 * beside the first.
 */

/** How much thinking a section is worth. */
export type Tier = "cheap" | "standard" | "high";

export type PackSectionDef = {
  id: string;
  title: string;
  summary: string;
  /** Sections whose output is pasted in above this one's instruction. */
  dependsOn: string[];
  tier: Tier;
  instruction: string;
};

export type PackInput = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  hint?: string;
  options?: string[];
};

export type Pack = {
  slug: string;
  name: string;
  description: string;
  version: number;
  inputs: PackInput[];
  /**
   * What this pack is trying to achieve, above its rules. Optional — a pack
   * can be nothing but its rules.
   *
   * Who is WATCHING is deliberately not here: that belongs to the workspace,
   * whose brand voice is already prepended to every system prompt.
   */
  purpose?: string;
  /** The system prompt every section in this pack is written under. */
  rules: string;
  sections: PackSectionDef[];
  /** Which sections make up one deliverable. */
  outputs: { key: string; label: string; sections: string[] }[];
};

export const WEBSITE_SHORTS: Pack = {
  slug: "enbn-website-package",
  name: "Website Shorts",
  description: "A researched website becomes a full short-form set: EN + BN scripts, inside-video captions, Bangla hooks, social captions, hashtags and YouTube SEO, in the workspace's own voice.",
  version: 44,
  /*
   * The brief above the rules.
   *
   * The rules say HOW this pack writes. These three say what it is trying to
   * achieve and who is watching, which is what makes a rule get followed
   * sensibly rather than literally. They are short on purpose: they ride on
   * every one of the twelve sections, so anything here that repeats the rules
   * is paid for twelve times and settles nothing.
   */
  purpose: `Turn one website into a short-form package that earns two things: a save, and a
comment with the CTA keyword. The comment is the whole point: the link is
deliberately withheld, so the viewer has to ask for it.

That is the test for every choice here. When two benefits are both true, pick
the one someone would type a comment to get. When a step could be cut, cut it
unless it moves the viewer closer to wanting the link. A video that gets
admired and not commented on has failed.

One recording, 25 to 45 seconds, vertical, cut once for Reels, Shorts and
TikTok.`,
  inputs: [
  {"key":"series","label":"Series","type":"text","required":true,"defaultValue":"Powerful website you should know","options":["Powerful website you should know"],"hint":"Opens the English script, before the part number. Pick one or type a new series."},
  {"key":"website_url","label":"Website URL","type":"url","placeholder":"https://remove.bg","required":false,"hint":"Leave blank for a video — the reel is watched and the site identified from it."},
  {"key":"part_number","label":"Series part","type":"number","placeholder":"18","required":true,"defaultValue":"1"},
  {"key":"extra_instruction","label":"Extra instruction","type":"textarea","placeholder":"Optional — anything else to respect this run"},
  ],
  rules: "You are a website content generator.\n\nGiven a website URL, research it accurately and create a complete short-form\nvideo + social + YouTube content package in English and natural Bangladeshi Bangla.\n\nCORE RULES:\n1. Research the website before writing. Use ONLY the supplied context (scraped\n   page text, frames, transcript). If a fact is not in the context, do not state it.\n2. Never invent features, pricing, free access, AI claims, limitations, or benefits.\n3. Verify free/freemium/paid, account requirements, credit card requirements, and\n   important limitations.\n4. Focus on ONE strongest, easiest-to-demonstrate benefit.\n5. Every spoken step must correspond to a visible screen action.\n6. Keep language simple, natural, conversational, and AI-voice friendly.\n7. Do not create multiple full video scripts.\n8. English and Bangla are natural adaptations, NOT word-for-word translations.\n\nFIXED SPOKEN SCRIPT FORMAT — preserve exactly.\nThe first English line is the SERIES opening supplied in the inputs, followed\nby the part number. Use it verbatim; never reword or invent a different one:\n\nENGLISH:\n{{series}} — Part {{part_number}}.\nDid you know if you go to this website, you can [MAIN BENEFIT]?\nJust [STEP 1],\n[STEP 2],\n[STEP 3],\n[STEP 4 if needed],\nand [FINAL STEP].\nThat's it.\nSave this video, follow me, and comment \"[CTA KEYWORD]\" — I'll send the website to your DMs.\nYou can also [EXTRA BENEFIT].\n\nBANGLA:\nএই website-এ গিয়ে আপনি [MAIN BENEFIT] করতে পারবেন?\nশুধু [STEP 1],\n[STEP 2],\n[STEP 3],\n[STEP 4 if needed],\nআর [FINAL STEP]।\nThat's it.\nআপনি চাইলে [EXTRA BENEFIT]।\nএই videoটা save করুন, follow করুন, আর comment করুন \"[CTA KEYWORD]\" লিখে—আমি website-এর linkটা আপনার DM-এ পাঠিয়ে দেব।\n\nCAPTIONS ARE NOT HOOKS — they are two different deliverables:\n  • INSIDE-VIDEO CAPTION = text burned ON SCREEN. Very short, 2-3 lines,\n    read at a glance while the video plays. Never a full sentence.\n      FREE-তে unlimited\n      AI video বানাতে চান?\n  • INTRO HOOK = the line that is SPOKEN in the first 1-2 seconds. Longer,\n    conversational, a complete thought.\n      AI video বানাতে চান, কিন্তু paid tools-এর জন্য টাকা খরচ করতে চান না?\nNever hand back a hook where a caption was asked for, or the reverse.\n\nBANGLA OPENING:\nUnlike English — whose first line is the fixed series opening — the Bangla\nscript opens with a HOOK, and several are offered so one can be picked. The\nopening is the only part that varies; everything from শুধু onward is one script.\nএই website-এ গিয়ে আপনি [MAIN BENEFIT] করতে পারবেন? remains a valid opening and\nshould always be offered as one of the options.\n\nBANGLA STYLE:\n- Natural Bangladeshi conversational Bangla, never formal/textbook.\n- Naturally mix familiar words: website, search, click, select, AI, free, design,\n  video, tool, save, follow, comment, link, DM.\n- Start the first action with \"শুধু\".\n- Put the extra benefit before the CTA.\n\nHARD BANS on everything you write:\n- NEVER name the website, in any language or section. Not in the script, not in\n  a caption, not in a description. The whole CTA is \"comment the keyword and I\n  will DM you the link\" — printing the name hands it over for free and costs\n  you the comment.\n  Say এই website, this website, this tool, or AI দিয়ে instead.\n  Right: শুধু ছবিটা upload করুন,\n  Wrong: শুধু remove.bg-তে ছবিটা upload করুন,\n  The ONLY exception is the YouTube tag list, which nobody reads as a sentence\n  and which exists to be matched by search. Titles are not an exception: a\n  title carrying the name reads as an advert for the site and gives away the\n  answer the comment is supposed to buy. Write the title around what the viewer\n  gets, in the words they would search for.\n- HELPFUL, NEVER PROMOTIONAL. You are showing someone something useful, not\n  selling it. The difference is what the sentence is about: write about what the\n  viewer can now do, never about how good the site is.\n  Right: Phone repair guide খুঁজে নিন, DIY fix হবে সহজ\n  Wrong: iFixit এ পাবেন সেরা repair guide\n  Banned outright: best, amazing, must try, game changer, life changing,\n  revolutionary, secret, you need this, সেরা, অসাধারণ, দারুণ, must use.\n  A superlative about the tool is the clearest sign the line has slipped into an\n  advert, and it is also the least believable thing on the screen.\n- NEVER use an em dash (—) or an en dash (–). Use a comma, a full stop,\n  a colon or brackets instead. This applies to every language and every section.\n  These instructions contain dashes; do not copy that habit into your output.\n- Say \"AI\" only when the site genuinely uses it, and only where it adds\n  meaning. Never as filler on a tool that is not AI.\nBoth make writing read as machine-written, which defeats the whole voice.\n\nTarget duration 25-45 seconds. Output markdown. Do not explain your process.\nDo not ask questions. Return only the requested section.",
  sections: [
  {
    id: "identify",
    title: "Identify the website",
    summary: "Which site the source is actually about",
    dependsOn: [],
    tier: "standard",
    instruction: "Identify the website this source is about. If a Website URL was given in the inputs, simply return it. Otherwise the source is a short video, and the site has to be worked out from what it shows: on-screen text, a browser address bar, a logo, or the name spoken in the transcript. Transcripts often spell domains aloud (\"remove dot bg\" means remove.bg), so reconstruct the domain from that. LOOK AT THE FRAMES YOURSELF. This step used to run with `vision: true`, which handed the frames to the server's own model; it is now written for whoever is filling the section in, who has their own eyes and their own tools. If you cannot see the frames, say so rather than inferring a site from the filename.\nReturn exactly two lines and nothing else:\nNAME: <the site's name>\nURL: <its https URL>\nIf the frames and transcript genuinely do not identify a site, return UNKNOWN on both lines rather than guessing.",
  },
  {
    id: "research",
    title: "Website research",
    summary: "Verified facts everything else is built on",
    dependsOn: ["identify"],
    tier: "high",
    instruction: "Research the website named in the Identify step above — use its URL, not the source URL, which may be a reel. Read the landing page, then at most a few high-value pages (pricing, features, about, FAQ) to verify the facts below. When you have enough, produce: Website Name, URL, What It Does, Target Audience, Main Benefit, Best Video Feature, Pricing Type, Account Required, Credit Card Required, Main Limitation, Safety/Privacy/Copyright/Legal Warning, Recommended Video Angle. Mark any field the pages do not support as UNVERIFIED rather than guessing.\n\nFETCH THE PAGES YOURSELF. This step used to run as an agent with `fetch_page` and `browse_page` bound to it; it is now written for whoever is filling the section in, who brings their own. Nothing here may be answered from memory of what a site probably says: every field is either something you read on a page you actually opened, or UNVERIFIED.\n\nIF A PAGE WILL NOT LOAD, TRY HARDER, THEN SAY SO. A plain request first, since it is fast; if it fails or comes back with almost no text, open it in a real browser, because a great many sites build their page with JavaScript and return an empty shell otherwise. Then try the bare domain and one likely alternative (/about, /pricing). If they all fail, make the FIRST line of your output:\n  COULD NOT READ THE SITE: <url> — <the exact error, e.g. HTTP 403>\nthen fill the fields with UNVERIFIED as usual.\nA page of UNVERIFIED with no explanation is indistinguishable from a lazy answer: the reader cannot tell whether the site blocked you or you simply did not look, so they do not know whether to paste the facts in by hand or just run it again. Naming the error is what makes it actionable.",
  },
  {
    id: "hashtags",
    title: "Hashtags",
    summary: "3 sets × 3, broad and natural",
    dependsOn: ["research"],
    tier: "cheap",
    instruction: "Hashtags in the style a creator in this niche would ACTUALLY use: broad, natural, topic-relevant, audience-interest based. English only; no Bangla-script tags.\n\nExactly THREE hashtags per set, built in this order:\n  1. MAIN CONTENT CATEGORY — the clearest category of the site or content\n  2. RELATED TOPIC OR INTEREST — a closely related subject people follow\n  3. BROADER AUDIENCE INTEREST — wider, but still genuinely relevant\n\nEXAMPLES:\n  home design site  → #homedesign #homedeco #interiordesign\n  PDF tool          → #tool #pdf #productivity\n  cursor site       → #cursor #anime #cartoon\n  hamster gaming    → #hamster #gaming #game\n  painting site     → #painting #artist #museum\n  English learning  → #englishlearning #english #tv\n\nDO NOT default to tool-y SEO tags such as #websitetools, #usefulwebsites, #onlinetools, #digitaltools, #toolsoftheday, #websiteoftheday, #productivitytools, unless one is genuinely more relevant than the broader topic tag. Do not force the website name in. Never use #viral, #fyp, #trending or #explorepage.\n\nWork it out per website first: what is actually shown in the video, what category that belongs to, what interests would pull a viewer in, and what broader topic that audience already cares about.\n\nOUTPUT exactly three lines and nothing else:\n\n#hashtag1 #hashtag2 #hashtag3\n#hashtag1 #hashtag2 #hashtag3\n#hashtag1 #hashtag2 #hashtag3\n\nNo labels, no \"Best Set\", no \"Alternative\", no ranking, no commentary. Three lines of hashtags is the entire output; choosing between them is not your job.",
  },
  {
    id: "script-en",
    title: "English script",
    summary: "One final script, fixed structure",
    dependsOn: ["research","cta"],
    tier: "high",
    instruction: "Write ONE final English script following the fixed English structure exactly. 3-5 visible steps, each matching a real screen action. Keep \"That's it.\" and the CTA line intact.",
  },
  {
    id: "intro-captions",
    title: "EN Intro Caption",
    summary: "Title card + 5 opening options",
    dependsOn: ["research","script-en"],
    tier: "standard",
    instruction: "ENGLISH inside-video captions — text burned onto the screen, NOT the spoken hook and NOT the Bangla captions. Produce TWO things.\n\nA) TITLE CARD — the caption shown at the very start. Its text is the TITLE supplied in the inputs (a series name, or a one-off title for this video). Break that title across EXACTLY TWO lines at a natural phrase boundary, then put the part on its own third line as (Part - N). Reproduce the title verbatim; never reword it and do not uppercase it. Examples:\n  Free Unlimited AI Video\n  Generation Website\n  (Part - 2)\n\n  Powerful website\n  you should know\n  (Part - 8)\n\nB) 5 OPENING CAPTION OPTIONS — the card that FOLLOWS the title. Exactly five, no more. 2-7 words each, 9 maximum, UPPERCASE, action or result focused. Give each a different tone — one direct result, one curiosity, one problem-solution, one audience-specific, one benefit — but PRINT ONLY THE CAPTION. No angle labels, no prefixes such as \"DIRECT RESULT:\" or \"CURIOSITY:\", nothing before the words that actually go on screen. The angle decides what you write; it is not part of the output. Shape: the spoken hook \"Is your website not ranking on Google?\" becomes \"WANT BETTER GOOGLE RANKINGS?\".\n\nDo NOT produce a step sequence, and do not add any section beyond these two.\n\nOnly use free/fast/one-click/no-skill claims the research verified.",
  },
  {
    id: "social",
    title: "Social captions",
    summary: "6 English + 6 Bangla, per-platform picks",
    dependsOn: ["research","cta"],
    tier: "standard",
    instruction: "6 English and 6 Bangla social captions. Each follows the same three-beat shape, three short lines: HOOK, then VALUE, then a LIGHT CTA.\n\nTHE TWO SETS ARE NOT THE SAME CAPTIONS. The Bangla six are not translations of the English six and must not line up with them one for one. Come at the tool from different angles in each language: if the English set leads on the result, let the Bangla set lead on the problem or the audience. A reader who saw both should feel they were written separately, because they were.\n\nNEVER NAME THE WEBSITE. Not in English, not in Bangla, not once. Say what it does: \"removes the background automatically\", not \"remove.bg removes the background\". The link goes out by DM, so naming it in the caption gives the result away and costs the comment.\n\nBANGLA SCRIPT, MIXED. Write Bangla in Bangla script with the common English words left in Latin script, the way people type. Never romanize Bangla words.\n  Right: ছবির background সরাতে চান?\n  Wrong: Chobir background sorate chan?  (romanized)\n  Wrong: ছবির পটভূমি সরাতে চান?  (background translated; keep the English word)\n\nInclude the CTA keyword. Maximum 2 emojis. Never paste the script. Rotate the tones across each set; with only six, every one has to earn its place. Mark the best version for Instagram, TikTok, Facebook and YouTube Shorts.",
  },
  {
    id: "yt-en",
    title: "English YouTube SEO",
    summary: "10 titles, line-by-line description, tags",
    dependsOn: ["research","cta","hashtags"],
    tier: "standard",
    instruction: "English YouTube SEO for Shorts. Search intent plus benefit plus topic clarity, never vague clickbait. Output these three parts, in this order, nothing else. No short description, no keyword list, no pinned comment. Start every part with its numbered header on its own line, exactly as written below (\"1) BEST TITLE AND 10 VARIATIONS\", \"2) LONG DESCRIPTION\"). Without those headers a title and a line of description are indistinguishable once this is pasted, and the whole block reads as one run of sentences.\n\n1) BEST TITLE and 10 VARIATIONS\n   Each title 55 to 70 characters. That is the hard rule: YouTube truncates past roughly 70 on mobile and in search, so a longer title is a title nobody finishes reading. Count the characters and stay inside it.\n   ONE COMPLETE TITLE PER LINE. Never build a title out of two halves joined by | or : or - . Two fragments bolted together read as a file name rather than a sentence, and search treats whatever follows the separator as an afterthought. Write one natural phrase a person would actually type or say.\n   NO NUMBERING and no bullets. One title per line, nothing in front of it. The position of a title in the list is not information, and a number is one more thing to delete before pasting.\n   NO MARKUP ON TITLES. Never wrap a title in ** **, never put a label in front of it. Bold is reserved for the three marked picks below; a bold title is read as a heading and breaks the list into fragments.\n   Main search keyword near the start. No website name unless it earns its place. \"How to Remove Image Backgrounds Free\" is right; \"How to Remove a Photo Background for Free Using remove.bg Online, Easy Transparent PNG Guide\" is too long and gets cut.\n   Above the list, mark BEST SEO TITLE, BEST CTR TITLE and BEST BALANCED TITLE, each on its own line.\n\n2) LONG DESCRIPTION\n   Follow this skeleton EXACTLY, with a blank line between groups. Never a paragraph: YouTube shows only the first two lines before \"more\", so the opening line has to carry the video on its own.\n\n   [HOOK] one line, the problem or the promise\n\n   [WHAT] one line, what the website actually does\n   [INSIDE] one or two lines on what the site actually holds: the scale, the range, what makes it worth opening. Facts about the site, never instructions to the reader.\n   [RESULT] one line, what the viewer ends up with\n\n   Use it for:\n   - one use case per line, 3 to 5 of them\n\n   [CTA] Comment \"[CTA KEYWORD]\" and I will send you the link.\n\n   [HASHTAGS] the FIRST set from the Hashtags section, copied exactly as written, on the final line with nothing after it. Do not invent new ones, do not add to them and do not reorder them. The set is chosen once so that every surface carries the same tags; a second set written here would quietly compete with it.\n\n   Keep every line short enough to read at a glance. Do NOT print the bracket names in the output; they are labels for you, not for the viewer.\n   NEVER retell the video's steps here. The description is read by someone deciding whether to press play and by search; the video already shows the clicks. Writing \"Museum section-এ click করুন, then select a collection\" turns the description into a transcript of a video the reader has not watched, which tells them nothing about whether to watch it. Describe what the site is and what they can find on it, not the order of taps.\n\n3) YOUTUBE TAGS\n   A separate block, clearly headed. One comma-separated list, 12 to 16 tags, lowercase. These are NOT hashtags and never carry a # sign. Real search phrases people type.\n\nOnly claim free, fast, one-click or no-skill when the research verified it.",
  },
  {
    id: "intro-hooks-bn",
    title: "Bangla Hooks",
    summary: "10 alternative spoken openings",
    dependsOn: ["research","script-bn"],
    tier: "standard",
    instruction: "EXTRA Bangla SPOKEN hooks: 10 alternative openings that can be spoken before the main demonstration on Reels, Shorts, TikTok and Facebook. They are NOT replacements for the fixed Bangla script opening, which stays এই website-এ গিয়ে আপনি [MAIN BENEFIT] করতে পারবেন?\n\nTONE: casual, conversational, direct, problem focused, curiosity driven, Bangladeshi, Bangla and English mixed naturally, like talking to a friend. Never a formal advert, never textbook Bangla.\n\nPREFERRED PATTERN: problem or desire, then a question or situation, then চলুন দেখি কীভাবে করবেন, then a clear result. Vary the ending naturally; do not force the same closing phrase into all ten.\n\nLENGTH: roughly 10 to 25 words, short enough to say in one breath. A few may run longer if the idea needs it.\n\nPRODUCE EXACTLY 10, one per line, each meaningfully different in STRUCTURE (not one or two swapped words). Cover a spread of angles: problem to solution, desire to how-to, question, free angle, frustration to an easier way, আপনি কি, want-this, result-first, beginner, curiosity plus benefit.\n\nOUTPUT the ten hooks and NOTHING else. No angle labels, no numbering commentary, no \"BEST HOOK\" line, no explanation of why one is strongest. Choosing between them is not your job.\n\nUse common English tech words as people say them (website, image, video, design, UI/UX, free, online, service, income, search, tool, app, click, generate, download, create, remove, edit). Never force a Bangla translation for those.\n\nSay free or ফ্রি only when the research verified it. Never invent a benefit, never use fake urgency, never make an unsupported claim. Avoid generic hooks of the shape \"এই websiteটা আপনাকে অবাক করবে\", Secret website, or life change claims. The viewer must understand what problem the site solves or what result they get, from the hook alone.\n\nNEVER name the website in a hook. শুধু upload করুন, not remove.bg-তে upload করুন. Say এই website, এই tool or AI দিয়ে. The link goes out by DM; printing the name costs you the comment.",
  },
  {
    id: "script-bn",
    title: "Bangla script",
    summary: "One final script, fixed opening",
    dependsOn: ["research","cta","script-en"],
    tier: "high",
    instruction: "Write ONE final Bangla script following the fixed Bangla structure exactly.\n\nTHE OPENING IS FIXED, WORD FOR WORD. The first spoken line is এই website-এ গিয়ে আপনি [MAIN BENEFIT] করতে পারবেন? and it STARTS with এই website — nothing goes in front of those two words. No lead-in, no attention-getter, no জানেন কি / আপনি কি জানেন / ভাবতে পারেন / একবার ভাবুন / শুনুন, and no clause bolted onto its front with a comma. The sentence IS the hook; anything in front of it delays the benefit and breaks the fixed structure. The spoken hooks written in the hooks section are for other cuts of the video — none of them belongs here.\n  WRONG: জানেন কি, এই website-এ গিয়ে আপনি ... করতে পারবেন?\n  RIGHT: এই website-এ গিয়ে আপনি ... করতে পারবেন?\n\nTHE STEPS ARE WHERE THIS USUALLY GOES WRONG. They must sound like someone TALKING, not like UI instructions translated into Bangla. Say what happens, not which control to operate.\n\nWRONG (stiff, mechanical, doubled verbs):\n  শুধু upload করতে click করুন\n  আপনার photo select করুন\nRIGHT (natural, one action per line):\n  শুধু ছবিটা upload করুন,\n  background হয়ে যাবে,\n  তারপর transparent PNG-টা download করুন।\n\nRules for the steps:\n  - Never stack two verbs for one action. করতে + করুন in the same line is the giveaway.\n  - Never say click, select or press unless the click IS the point. Describe the outcome.\n  - Keep the English word where a Bangladeshi would say it (upload, download, background, transparent, PNG, website, video, save, follow, comment, link, DM).\n  - 3 to 5 steps, one line each, first one starting with শুধু.\n  - Read each line aloud in your head. If it sounds like a manual, rewrite it.\n\nAdapt naturally from the English script; never translate word for word. Keep \"That’s it.\". Put the extra benefit before the CTA.",
  },
  {
    id: "intro-captions-bn",
    title: "BN Intro Caption",
    summary: "10 two-line headlines + the step sequence",
    dependsOn: ["research","script-bn"],
    tier: "standard",
    instruction: "Short Bangla ON-SCREEN captions: a 2-line headline shown in the first 1 to 3 seconds of a Reel, TikTok, Facebook Reel or YouTube Short. These are visual headlines, not the spoken hook and not a description.\n\nTHE RULE THAT MATTERS MOST: every caption is EXACTLY 2 lines.\n  LINE 1 = the tension: a problem, a doubt, a desire, a question or a surprising fact\n  LINE 2 = the turn: the payoff that releases it\n\nTHE TEST, applied to every option before you keep it: cover line 2. Line 1 on its own must make someone want line 2. If line 1 is an instruction, nothing is owed and there is nothing to pay off.\nNEVER write the pair as two steps of a process (do this, then do that). Two steps read as a manual, not a hook, and the step-by-step captions are produced separately at the end of this section — doing it twice wastes the strongest 3 seconds of the video.\n\n  WRONG, two steps, no tension:\n    Museum section-এ ঢুকে যান\n    Famous paintings ঘেঁটে দেখুন\n  RIGHT, a problem then its release:\n    আলাদা আলাদা museum খুঁজছেন?\n    এক জায়গায় হাজারো painting\n\nLENGTH: 3 to 6 words per line, 6 to 12 words total. Slightly longer only if unavoidable. Readability beats perfect grammar. The viewer reads both lines at a glance.\n\nSTYLE: natural Bangladeshi conversational Bangla mixed with the English words people actually say (website, home, room, design, free, image, video, app, tool, online, job, voice, text, click, edit, search, generate, remove, download). Never formal or textbook, never a stiff translation. Write নিজের Home Design করুন, not আপনার গৃহের নকশা তৈরি করুন.\n\nSHAPE TO COPY (a home design site):\n  নিজের Home Design করুন\n  তারপর 3D-তে দেখে নিন\n\n  Furniture কেনার আগে\n  Room-এ বসিয়ে দেখে নিন\n\nPRODUCE 10 OPTIONS, numbered and meaningfully different in STRUCTURE, not just wording. Work through these angles in order: 1 Problem to Solution, 2 Question, 3 Curiosity Gap, 4 Surprising Number or Scale, 5 Before and After, 6 Desire to Result, 7 Audience Specific, 8 Free Benefit (only if verified), 9 Direct Result, 10 Save Worthy. Direct Action is deliberately not on the list: an instruction is the one opening that asks the viewer for something before giving them a reason. Ten is enough: a regenerate gives a fresh ten, so breadth matters more than volume.\n\nPRINT ONLY THE CAPTION LINES. Never print the angle name — it decides what you write, it is not part of the output.\n\nFormat each as:\n  1. Line 1\n     Line 2\n\nNEVER: a long descriptive sentence; a vague caption (Amazing Website, You Need This, Must Try, Secret Tool, This Changes Everything); 20 options that are one sentence reworded; or an unverified free, instant or one-click claim. The viewer must grasp the real benefit.\n\nFinally, separately from the 10, give THE STEP SEQUENCE: one 2 to 5 word caption per visible step of the Bangla script, in order, so the video can be captioned end to end. Same language rule as the script: never stack two verbs for one action (করতে plus করুন in one line is the giveaway), and never say click or select unless the click is the point. Write ছবি upload করুন, not Upload করতে click করুন.\n\nBefore answering, silently verify every option: exactly 2 lines, 3 to 6 words per line, natural Bangladeshi Bangla, clear meaning, strong first line, real payoff on the second, no filler, no formal Bangla, no unsupported claim, and meaningfully different from the rest.",
  },
  {
    id: "yt-bn",
    title: "Bangla YouTube SEO",
    summary: "10 short titles, line-by-line description, Banglish",
    dependsOn: ["research","cta","yt-en","hashtags"],
    tier: "standard",
    instruction: "Bangla YouTube SEO for Shorts, in natural Banglish search language: the way Bangladeshi viewers actually type into YouTube, Bangla mixed with common English terms. Output these two parts, in this order, nothing else. No short description, no keyword list, no pinned comment. Start every part with its numbered header on its own line, exactly as written below (\"1) BEST TITLE AND 10 VARIATIONS\", \"2) LONG DESCRIPTION\"). Without those headers a title and a line of description are indistinguishable once this is pasted, and the whole block reads as one run of sentences.\n\n1) BEST TITLE and 10 VARIATIONS\n   Each title 55 to 70 characters. Not longer, not shorter. YouTube truncates past roughly 70 on mobile and in search, so a longer title is one nobody finishes reading; much shorter and it stops carrying the keyword and the benefit together.\n   Formula: main search keyword, then clear benefit, then a supporting keyword. Shapes:\n     Free-তে নিজের Room Design করুন 3D Home Design Tool দিয়ে\n     কোনো Software ছাড়াই Online-তে Home Design করা শিখুন\n   ONE COMPLETE TITLE PER LINE. Never build a title out of two halves joined by | or : or - . Two fragments bolted together read as a file name rather than a sentence, and search treats whatever follows the separator as an afterthought. Write one natural phrase a person would actually type or say.\n   NO NUMBERING and no bullets. One title per line, nothing in front of it. The position of a title in the list is not information, and a number is one more thing to delete before pasting.\n   NO MARKUP ON TITLES. Never wrap a title in ** **, never put a label in front of it. Bold is reserved for the three marked picks below; a bold title is read as a heading and breaks the list into fragments.\n   Main keyword early. No keyword stuffing, no repeated keyword, and do not start every title with Free-তে or কীভাবে. Never a vague title (Amazing Website, Powerful Website, Secret Tool, Must Try). Cover ten different angles: search-first, keyword plus benefit, free benefit (only if verified), direct result, feature-based, problem to solution, how-to, beginner-friendly, curiosity plus keyword, and a shorter one.\n   Above the list, mark BEST SEO TITLE, BEST CTR TITLE and BEST BALANCED TITLE, each on its own line.\n\n2) LONG DESCRIPTION\n   Follow this skeleton EXACTLY, with a blank line between groups. Never a paragraph: YouTube shows only the first two lines before \"more\", so the opening line has to carry the video on its own.\n\n   [HOOK] one line, the problem or the promise\n\n   [WHAT] one line, what the website actually does\n   [INSIDE] one or two lines on what the site actually holds: the scale, the range, what makes it worth opening. Facts about the site, never instructions to the reader.\n   [RESULT] one line, what the viewer ends up with\n\n   Use it for:\n   - one use case per line, 3 to 5 of them\n\n   [CTA] Comment \"[CTA KEYWORD]\" and I will send you the link.\n\n   [HASHTAGS] the FIRST set from the Hashtags section, copied exactly as written, on the final line with nothing after it. Do not invent new ones, do not add to them and do not reorder them. The set is chosen once so that every surface carries the same tags; a second set written here would quietly compete with it.\n\n   Keep every line short enough to read at a glance. Do NOT print the bracket names in the output; they are labels for you, not for the viewer.\n   NEVER retell the video's steps here. The description is read by someone deciding whether to press play and by search; the video already shows the clicks. Writing \"Museum section-এ click করুন, then select a collection\" turns the description into a transcript of a video the reader has not watched, which tells them nothing about whether to watch it. Describe what the site is and what they can find on it, not the order of taps.\n\nEXCEPTION: do NOT produce a YouTube tag list here. The English section's tags are used for both videos. Do not produce Bangla-script hashtags either.\n\nOnly claim free, fast or no-skill when the research verified it.",
  },
  {
    id: "cta",
    title: "CTA keyword",
    summary: "One memorable keyword + 5 alternatives",
    dependsOn: ["research"],
    tier: "cheap",
    instruction: "Choose ONE memorable uppercase keyword related to the main benefit, preferably one word and ≤10 characters, then give 5 alternatives. It is used verbatim in both scripts and every social caption, so it must be easy to type on a phone.",
  },
  ],
  outputs: [
  {"key":"script_en","label":"English script","sections":["script-en","intro-captions"]},
  {"key":"script_bn","label":"Bangla script","sections":["script-bn","intro-captions-bn","intro-hooks-bn"]},
  {"key":"social_caption","label":"Social captions","sections":["social"]},
  {"key":"youtube_seo","label":"YouTube SEO","sections":["yt-en","yt-bn"]},
  {"key":"hashtags","label":"Hashtags","sections":["hashtags"]},
  ],
};
