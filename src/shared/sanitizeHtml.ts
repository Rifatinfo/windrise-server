import DOMPurify from "isomorphic-dompurify";

export const PRODUCT_DESCRIPTION_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "img",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "span",
  "mark",
  "code",
  "pre",
];

export const PRODUCT_DESCRIPTION_ALLOWED_ATTR = [
  "href",
  "target",
  "rel",
  "src",
  "alt",
  "title",
  "style",
  "data-color",
  "colspan",
  "rowspan",
];

DOMPurify.addHook("afterSanitizeAttributes", (node: any) => {
  if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
});

/**
 * Sanitizes admin-authored product description HTML down to a safe
 * allowlist before it is persisted. This is the source of truth for what
 * ends up in the database — the client sanitizes too, but that is only a
 * UX/defense-in-depth layer, not something this server can trust.
 */
export function sanitizeProductDescription(
  html: string | null | undefined
): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: PRODUCT_DESCRIPTION_ALLOWED_TAGS,
    ALLOWED_ATTR: PRODUCT_DESCRIPTION_ALLOWED_ATTR,
  }).trim();
}

/**
 * Blog posts carry richer blocks than product descriptions — embeds, media,
 * galleries, callouts, accordions — so they get their own, wider allowlist.
 * Still an allowlist: no scripts, no event handlers, no arbitrary elements.
 *
 * Must stay in sync with the client's `sanitizePostContent`.
 */
export const POST_CONTENT_ALLOWED_TAGS = [
  ...PRODUCT_DESCRIPTION_ALLOWED_TAGS,
  "div",
  "figure",
  "figcaption",
  "iframe",
  "video",
  "audio",
  "source",
  "details",
  "summary",
  "sup",
  "sub",
  "kbd",
  "small",
  // Column widths from a resized table are serialized as a colgroup.
  "colgroup",
  "col",
];

export const POST_CONTENT_ALLOWED_ATTR = [
  ...PRODUCT_DESCRIPTION_ALLOWED_ATTR,
  "class",
  "id",
  // Block alignment for images, video and embeds.
  "data-align",
  "data-free",
  "controls",
  "loading",
  "allow",
  "allowfullscreen",
  "download",
  "open",
  "width",
  "height",
  "type",
];

/** Only these hosts may be framed into a post. */
const ALLOWED_IFRAME_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
];

DOMPurify.addHook("afterSanitizeAttributes", (node: any) => {
  if (node.tagName !== "IFRAME") return;
  const src = node.getAttribute("src") ?? "";
  let host = "";
  try {
    host = new URL(src, "https://example.com").hostname;
  } catch {
    host = "";
  }
  if (!ALLOWED_IFRAME_HOSTS.includes(host)) node.remove();
});

/**
 * Sanitizes admin-authored blog post HTML before it is persisted. Same
 * contract as `sanitizeProductDescription` — the client sanitizes too, but
 * this is the copy that decides what reaches the database.
 */
export function sanitizePostContent(html: string | null | undefined): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: POST_CONTENT_ALLOWED_TAGS,
    ALLOWED_ATTR: POST_CONTENT_ALLOWED_ATTR,
    ADD_URI_SAFE_ATTR: ["download"],
  }).trim();
}

export function stripHtmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const text = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A Tiptap-empty document serializes to "<p></p>" — treat that (and
 * whitespace-only content) as empty even though the string is non-empty.
 */
export function hasMeaningfulHtmlContent(
  html: string | null | undefined
): boolean {
  if (!html) return false;
  if (stripHtmlToText(html).length > 0) return true;
  return /<(img|table|hr)\b/i.test(html);
}
