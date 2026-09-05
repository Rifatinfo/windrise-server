import { stripHtmlToText } from "../../../shared/sanitizeHtml";

/**
 * The SEO checklist shown beside the post editor.
 *
 * The weights add up to 100 so a post that only has a title scores 15 —
 * matching the score ring in the editor. The identical rule set lives in the
 * client at `src/utils/seoScore.ts` so the ring can update as you type; keep
 * the two in step if a check is ever added or reweighted.
 */
export type SeoCheck = {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
};

export type SeoInput = {
  title?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  focusKeyword?: string | null;
  content?: string | null;
};

export const countWords = (html?: string | null): number => {
  const text = stripHtmlToText(html ?? "").trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
};

export const buildSeoChecks = (input: SeoInput): SeoCheck[] => {
  const title = (input.title ?? "").trim();
  const metaTitle = (input.metaTitle ?? "").trim();
  const metaDescription = (input.metaDescription ?? "").trim();
  const focusKeyword = (input.focusKeyword ?? "").trim();
  const words = countWords(input.content);

  return [
    {
      id: "title",
      label: "Add a post title",
      passed: title.length > 0,
      weight: 15,
    },
    {
      id: "meta-title",
      label: "Set a meta title (≤60 chars)",
      passed: metaTitle.length > 0 && metaTitle.length <= 60,
      weight: 20,
    },
    {
      id: "meta-description",
      label: "Set a meta description (120–160 chars)",
      passed: metaDescription.length >= 120 && metaDescription.length <= 160,
      weight: 25,
    },
    {
      id: "focus-keyword",
      label: "Add a focus keyword",
      passed: focusKeyword.length > 0,
      weight: 20,
    },
    {
      id: "word-count",
      label: "Write at least 300 words",
      passed: words >= 300,
      weight: 20,
    },
  ];
};

export const computeSeoScore = (input: SeoInput): number =>
  buildSeoChecks(input).reduce(
    (total, check) => total + (check.passed ? check.weight : 0),
    0,
  );

/** Band shown in the posts table's SEO column. */
export const seoBand = (score: number): "Good" | "OK" | "Needs work" =>
  score >= 70 ? "Good" : score >= 40 ? "OK" : "Needs work";
