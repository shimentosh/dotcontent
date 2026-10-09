# Templates: what dotcontent can make

A **template** is a reusable content brief. You write it once, then point it at
any topic, and it writes every piece of content that topic needs: a blog post,
a week of social posts, the first comment under each one, an email, a video
script. Anything that is text.

dotcontent ships with seven example templates, each a different kind of
content. Use them as they are, or copy one and change it into your own.

| Template | Use it for | You get | Example topic |
|---|---|---|---|
| [SEO Blog Post](#seo-blog-post) | Blogs, SEO, content marketing | Keyword research, outline, title and meta description, the full article, an FAQ, social posts to promote it | *How to write AI prompts that actually work* |
| [Social Media Post Pack](#social-media-post-pack) | Daily posting, social media management | Facebook statuses, an Instagram caption, a LinkedIn post, X posts and a thread, the first comment under each, hashtags | *Why sunscreen still matters in winter* |
| [Honest Product Review](#honest-product-review) | Affiliate sites, review channels, e-commerce | Pros and cons with a verdict, a review video script, a written review, a social caption with first comment, YouTube copy | *Kindle Paperwhite* |
| [Newsletter Email](#newsletter-email) | Newsletters, email marketing | An issue plan, 10 subject lines with preview text, the email, a post to bring in subscribers | *Three AI tools I kept using this month* |
| [Repurpose a Video](#repurpose-a-video) | Podcasts, YouTube, webinars | Takeaways and quotes, short clip ideas, a blog article, LinkedIn, Facebook and X posts, an Instagram carousel | A video link |
| [Product Launch Campaign](#product-launch-campaign) | Brands, agencies, launches | A launch brief, teaser posts, launch-day posts with first comments, launch and reminder emails, a video script, ad copy | *Acme Glow Vitamin C Serum* |
| [Website Shorts](#website-shorts) | Reels, YouTube Shorts, TikTok | English and Bangla scripts, on-screen captions, spoken hooks, social captions, hashtags, YouTube SEO | A website link |

On a fresh install every sample workspace has a shelf of topics waiting under
one of these templates. Open a workspace, go to **Content**, and press Run on
any topic to see what it makes.

## How a template works

```
 brand voice      who you are and how you sound      (set on the workspace)
 + purpose        what this template is trying to achieve
 + rules          how it writes
 ──────────────────────────────────────────────────────────────
 sections         one per piece of content, each with its own instruction
```

- **Sections run in order of their dependencies.** A section can read the
  sections before it. The blog post is handed the research and the outline;
  the first comments are handed the posts they sit under. Sections that do not
  depend on each other are queued together, so several machines can write
  them at once.
- **Every section has a tier:** *cheap*, *standard* or *high*. It decides how
  much thinking the model spends. Hashtags are cheap; a 1,500-word article is
  high.
- **Outputs group sections into deliverables,** so the reader shows *Blog
  post*, *SEO brief* and *Promotion* rather than six loose sections.
- **The brand voice always comes first.** The same template run in two
  workspaces writes in two voices, and in each workspace's language.

## Running one

1. **Make a series for the template.** In **Content → Manage series**, add a
   series (for example *Blog*) and set its template (for example *SEO Blog
   Post*).
2. **Add topics to it.** One topic is one piece of work: a keyword, a product,
   an idea or a link. The topic's context box is for notes that run should
   know, such as a price, a story or a point of view.
3. **Press Run.** Each section is written by a machine and appears as it
   lands. Rewrite any single section, copy it, or download the lot.

To work from a video, open the run sheet (**Create → Generate from Template**), choose
the topic, paste the video's link and press **Fetch**. The worker downloads it
and transcribes it, and every section is written from the transcript.

## The example templates

### SEO Blog Post

**For:** bloggers, SEO writers, content marketers.
**Topic:** a keyword or a question, such as *how to start a podcast on a
budget*. Put your own experience or a product to mention in the topic's
context.

| Section | What it writes |
|---|---|
| Search intent and keywords | The primary keyword, the intent, secondary keywords, questions people ask, the angle |
| Outline | Every H2 and H3 with a line on what it says, and the target length |
| Title, meta description and slug | 5 titles, 2 meta descriptions, a URL slug |
| Blog post | The full article, following the outline |
| FAQ | 5 questions and answers, sized for FAQ schema |
| Social posts to promote it | LinkedIn, X and Facebook posts, each with a first comment carrying the link |

### Social Media Post Pack

**For:** social media managers, small businesses, anyone posting every day.
**Topic:** what the post is about, such as *3 mistakes people make when
pricing a service*.

| Section | What it writes |
|---|---|
| Core message and angle | The one point, three possible angles, and the one chosen |
| Facebook posts | A short status, a story post and a question post |
| Instagram caption | A caption with line breaks, plus 3 alternative first lines |
| LinkedIn post | A first-person post that ends in a question |
| X posts and thread | 3 single posts and a 5-post thread |
| First comments | The comment to post under each post yourself |
| Hashtags | A set sized for each platform |

### Honest Product Review

**For:** affiliate marketers, review channels, e-commerce stores.
**Topic:** the product, such as *Kindle Paperwhite*. To have the product page
read, use its link as the topic instead: the server reads the page and the
research works from it. Put your own notes from using it in the topic's
context, because the review leans on first-hand experience.

| Section | What it writes |
|---|---|
| Product facts | Price, specs, what is in the box, alternatives, and your notes kept apart |
| Verdict, pros and cons | The catch, pros, cons, buy it if, skip it if, a score |
| Video review script | 45 to 60 seconds, with on-screen text and shots |
| Written review | A blog review with a summary box |
| Social caption and first comment | A caption, and a first comment with the affiliate link and disclosure |
| YouTube title and description | 5 honest titles and a description with disclosure and tags |

### Newsletter Email

**For:** newsletter writers, email marketing.
**Topic:** this issue's subject. The series name is used as the newsletter's
name, and the topic's context is for links or news to include.

| Section | What it writes |
|---|---|
| Issue plan | The one idea, what the reader gets, the structure and the call to action |
| Subject lines and preview text | 10 subject lines, the best three with preview text |
| The email | The whole issue, greeting to P.S. |
| Social post for new subscribers | A post sharing the best part, with a sign-up link in the first comment |

### Repurpose a Video

**For:** podcasters, YouTubers, anyone with webinars or talks.
**Topic:** what the video is about. Paste the video's link in the run sheet so
it is transcribed; every quote then comes word for word from the transcript.

| Section | What it writes |
|---|---|
| Key takeaways and quotes | The core message, key points, quotable lines, numbers mentioned |
| Short clip ideas | 3 to 5 clips to cut, each with its opening quote and captions |
| Blog article | The video written up as an article, with quotes |
| Social posts | LinkedIn, Facebook, an X thread and a 7-slide Instagram carousel |
| First comments and hashtags | What to post under each, and hashtags per platform |

### Product Launch Campaign

**For:** brands, agencies, founders launching a product or an offer.
**Topic:** the product or offer. Put the launch date, price, offer and link in
the topic's context. Anything left out becomes a `[PLACEHOLDER]` instead of
an invented detail.

| Section | What it writes |
|---|---|
| Launch brief | What it is, for whom, the promise, the proof, the offer |
| Teaser posts | Posts for 7, 3 and 1 day before, with story text |
| Launch-day posts | Instagram, Facebook and LinkedIn, each with a first comment |
| Launch and reminder emails | The launch email and a reminder 48 hours later |
| Launch video script | 30 seconds, with on-screen text and shots |
| Ad copy | 3 Meta ad variations with headline and description |

### Website Shorts

**For:** short-form video creators who show useful websites and tools.
**Topic:** a website's link, on a numbered series (*Part 18*). It writes in
English and Bangla, and holds the website's name back so viewers comment to
get the link.

Twelve sections: identify the website, research it, CTA keyword, hashtags,
English script, English on-screen captions, Bangla script, Bangla on-screen
captions, Bangla spoken hooks, social captions, and English and Bangla YouTube
SEO. It is the most detailed of the seven, and the best one to read when you
want to see how far a template's instructions can go.

## Writing your own

Open **Templates → Create Template**.

1. **Name it, and write the purpose.** One short paragraph on what this
   content is for and what makes it succeed. It rides on every section, so
   keep it short.
2. **Write the rules.** How it writes: format, length, tone, what it must
   never do. Anything true of every section belongs here, not repeated in
   each one.
3. **Add sections.** Drag them in from the palette (Article, Social post,
   Script, Caption, Email, First comment, Hook, Title, Description, Hashtags,
   CTA, Research, Plan) or type your own. Each section's instruction says what
   to write and how long. Set what it depends on, and its tier.

Tips:

- **One section, one thing you would paste somewhere.** "LinkedIn post" is a
  section. "All the social media" is four.
- **Research first.** A section that gathers facts, which later sections
  depend on, stops every later section from inventing its own.
- **Ask for placeholders.** "If the price is not given, write [PRICE]" is the
  difference between a draft you can trust and one you have to fact-check.
- **Share it.** Every template exports as a `.template.json` file, and
  **Import template** brings one in on another console.

### Placeholders

Type these into any instruction, purpose or rule. Each run fills them in from
its topic:

| Placeholder | Filled with |
|---|---|
| `{{topic}}` | The topic's own name: a product, a keyword, an idea, or a link |
| `{{series}}` | The name of the series the topic is on |
| `{{part}}` | The part as the series names it, such as *Episode 07* |
| `{{part_number}}` | Just the number, such as *07* |
| `{{part_label}}` | Just the word, such as *Episode* |
| `{{series_context}}` | What the series is about |
| `{{website_url}}` | The topic, when the topic is a link |
| `{{extra_instruction}}` | The topic's own context box |

### More ideas

Templates people build with dotcontent:

- **YouTube long-form:** research, outline, script with chapters, title, description, timestamps, pinned comment
- **Podcast show notes:** summary, timestamps, guest bio, quotes, social posts
- **E-commerce product page:** product description, bullet benefits, SEO title, meta description, FAQ
- **Facebook page, daily:** a morning status, a question post, a tip post, and the first comment under each
- **LinkedIn carousel:** slide-by-slide text, caption, first comment
- **Cold email outreach:** a first email, two follow-ups, subject lines
- **Case study:** the problem, the solution, the results, a quote, a summary post
- **Event promotion:** an announcement, a countdown, a reminder email, a recap post
- **App store listing:** title, subtitle, description, keywords, release notes
- **Comment replies:** friendly replies to the most common comments on a post
