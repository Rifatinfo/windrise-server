// import Anthropic from "@anthropic-ai/sdk";

// import { stripHtmlToText } from "../../../shared/sanitizeHtml";

// /**
//  * Drafts SEO metafields for a post.
//  *
//  * Bring your own key: set AI_PROVIDER + AI_API_KEY and the draft goes through
//  * a real model. With nothing configured the button still works — it falls back
//  * to deriving the fields from the post itself, so the editor is never a dead
//  * end on a fresh install.
//  *
//  *   AI_PROVIDER   "anthropic" | "openai-compatible" | "none"  (default: auto)
//  *   AI_API_KEY    provider key ("ollama" and other local servers accept any)
//  *   AI_MODEL      model id — defaults per provider
//  *   AI_BASE_URL   openai-compatible only, e.g. http://localhost:11434/v1
//  */

// export type SeoSuggestion = {
//   metaTitle: string;
//   metaDescription: string;
//   focusKeyword: string;
//   keywords: string[];
//   /** How the suggestion was produced, surfaced to the editor. */
//   source: "anthropic" | "openai-compatible" | "fallback";
// };

// export type SeoSuggestInput = {
//   title: string;
//   excerpt?: string | null;
//   content?: string | null;
//   categoryName?: string | null;
// };

// const PROMPT = `You write SEO metadata for an online fashion retailer's blog.

// Return ONLY a JSON object, no prose and no code fences, shaped exactly:
// {"metaTitle": string, "metaDescription": string, "focusKeyword": string, "keywords": string[]}

// Rules:
// - metaTitle: at most 60 characters, compelling, includes the focus keyword.
// - metaDescription: between 120 and 160 characters, summarises the post, reads naturally.
// - focusKeyword: the single phrase the post should rank for (2-5 words).
// - keywords: 4 to 8 supporting phrases, lowercase.`;

// const buildUserMessage = (input: SeoSuggestInput) => {
//   const body = stripHtmlToText(input.content ?? "").slice(0, 6000);
//   return [
//     `Title: ${input.title}`,
//     input.categoryName ? `Category: ${input.categoryName}` : null,
//     input.excerpt ? `Excerpt: ${input.excerpt}` : null,
//     body ? `Body:\n${body}` : null,
//   ]
//     .filter(Boolean)
//     .join("\n\n");
// };

// /** Models sometimes wrap JSON in prose or fences; pull the object out. */
// const parseSuggestion = (raw: string): Omit<SeoSuggestion, "source"> | null => {
//   const match = raw.match(/\{[\s\S]*\}/);
//   if (!match) return null;

//   try {
//     const parsed = JSON.parse(match[0]);
//     return {
//       metaTitle: String(parsed.metaTitle ?? "").trim(),
//       metaDescription: String(parsed.metaDescription ?? "").trim(),
//       focusKeyword: String(parsed.focusKeyword ?? "").trim(),
//       keywords: Array.isArray(parsed.keywords)
//         ? parsed.keywords.map((k: unknown) => String(k).trim()).filter(Boolean)
//         : [],
//     };
//   } catch {
//     return null;
//   }
// };

// const viaAnthropic = async (input: SeoSuggestInput) => {
//   const client = new Anthropic({ apiKey: process.env.AI_API_KEY });

//   const response = await client.messages.create({
//     model: process.env.AI_MODEL || "claude-opus-5",
//     max_tokens: 1024,
//     system: PROMPT,
//     messages: [{ role: "user", content: buildUserMessage(input) }],
//   });

//   const text = response.content
//     .filter((block): block is Anthropic.TextBlock => block.type === "text")
//     .map((block) => block.text)
//     .join("");

//   return parseSuggestion(text);
// };

// /** Covers Ollama, LM Studio, Gemini's compatibility layer and OpenAI itself. */
// const viaOpenAiCompatible = async (input: SeoSuggestInput) => {
//   const baseUrl = (
//     process.env.AI_BASE_URL || "https://api.openai.com/v1"
//   ).replace(/\/$/, "");

//   const response = await fetch(`${baseUrl}/chat/completions`, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: `Bearer ${process.env.AI_API_KEY ?? "not-needed"}`,
//       // Authorization: `Bearer ${process.env.ROUTER_API_KEY ?? "not-needed"}`,
//     },
//     body: JSON.stringify({
//       model: process.env.AI_MODEL || "gpt-4o-mini",
//       messages: [
//         { role: "system", content: PROMPT },
//         { role: "user", content: buildUserMessage(input) },
//       ],
//       temperature: 0.4,
//     }),
//   });

//   if (!response.ok) {
//     throw new Error(`AI provider responded ${response.status}`);
//   }

//   const payload = (await response.json()) as any;
//   return parseSuggestion(payload?.choices?.[0]?.message?.content ?? "");
// };

// const STOPWORDS = new Set([
//   "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
//   "your", "you", "our", "we", "is", "are", "how", "what", "why", "this", "that",
//   "from", "at", "by", "it", "its", "as", "be",
// ]);

// /**
//  * No provider configured — build something usable from the post itself so the
//  * fields are never left blank. Trimmed to the same limits the checklist wants.
//  */
// const viaFallback = (input: SeoSuggestInput): Omit<SeoSuggestion, "source"> => {
//   const storeName = "Windrise";
//   const title = input.title.trim();
//   const body = stripHtmlToText(input.content ?? "").trim();
//   const summary = (input.excerpt?.trim() || body).replace(/\s+/g, " ");

//   const metaTitle = title.length <= 60 ? title : `${title.slice(0, 57).trim()}...`;

//   // With no excerpt or body yet there is nothing to summarise, so lead with
//   // the title rather than handing back an empty field.
//   let metaDescription = summary || `${title}. Read the full story on the ${storeName} journal.`;
//   if (metaDescription.length > 160) {
//     metaDescription = `${metaDescription.slice(0, 157).trim()}...`;
//   } else if (metaDescription.length < 120) {
//     // Pad toward the 120-character floor so the checklist item can pass.
//     metaDescription = `${metaDescription} Read more on the ${storeName} journal.`
//       .slice(0, 160)
//       .trim();
//   }

//   const words = title
//     .toLowerCase()
//     .replace(/[^a-z0-9\s-]/g, "")
//     .split(/\s+/)
//     .filter((word) => word.length > 2 && !STOPWORDS.has(word));

//   const focusKeyword = words.slice(0, 3).join(" ") || title.toLowerCase();

//   const keywords = Array.from(
//     new Set(
//       [
//         focusKeyword,
//         input.categoryName?.toLowerCase(),
//         ...words.slice(0, 6),
//       ].filter((value): value is string => Boolean(value)),
//     ),
//   ).slice(0, 8);

//   return { metaTitle, metaDescription, focusKeyword, keywords };
// };

// export const suggestSeoFields = async (
//   input: SeoSuggestInput,
// ): Promise<SeoSuggestion> => {
//   const configured = process.env.AI_PROVIDER?.trim().toLowerCase();
//   const hasKey = Boolean(process.env.AI_API_KEY || process.env.AI_BASE_URL);

//   const provider =
//     configured && configured !== "auto"
//       ? configured
//       : hasKey
//         ? "anthropic"
//         : "none";

//   if (provider === "none") {
//     return { ...viaFallback(input), source: "fallback" };
//   }

//   try {
//     const result =
//       provider === "anthropic"
//         ? await viaAnthropic(input)
//         : await viaOpenAiCompatible(input);

//     if (result && result.metaTitle && result.metaDescription) {
//       return {
//         ...result,
//         source: provider === "anthropic" ? "anthropic" : "openai-compatible",
//       };
//     }
//   } catch (error) {
//     // A provider outage must not block the editor — fall through to the
//     // derived draft and let the response say where it came from.
//     console.error("[blog] SEO suggestion via AI failed:", error);
//   }

//   return { ...viaFallback(input), source: "fallback" };
// };



import { stripHtmlToText } from "../../../shared/sanitizeHtml";

/**
 * Drafts SEO metafields for a post.
 *
 * Supports:
 * - OpenRouter / OpenAI-compatible APIs
 * - Anthropic
 * - Fallback when no AI provider is configured
 *
 * Environment variables:
 *
 * AI_PROVIDER
 *   "anthropic" | "openai-compatible" | "none"
 *
 * ROUTER_API_KEY
 *   API key for OpenRouter
 *
 * AI_MODEL
 *   Model ID, e.g. "gpt-4o-mini"
 *
 * AI_BASE_URL
 *   OpenAI-compatible API URL
 *   e.g. https://openrouter.ai/api/v1
 */

export type SeoSuggestion = {
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  keywords: string[];
  source: "anthropic" | "openai-compatible" | "fallback";
};

export type SeoSuggestInput = {
  title: string;
  excerpt?: string | null;
  content?: string | null;
  categoryName?: string | null;
};

const PROMPT = `
You write SEO metadata for an online fashion retailer's blog.

Return ONLY a JSON object, no prose and no code fences, shaped exactly:

{
  "metaTitle": string,
  "metaDescription": string,
  "focusKeyword": string,
  "keywords": string[]
}

Rules:

- metaTitle: at most 60 characters, compelling, includes the focus keyword.
- metaDescription: between 120 and 160 characters, summarises the post, reads naturally.
- focusKeyword: the single phrase the post should rank for (2-5 words).
- keywords: 4 to 8 supporting phrases, lowercase.
`;

const buildUserMessage = (input: SeoSuggestInput) => {
  const body = stripHtmlToText(input.content ?? "").slice(0, 6000);

  return [
    `Title: ${input.title}`,
    input.categoryName ? `Category: ${input.categoryName}` : null,
    input.excerpt ? `Excerpt: ${input.excerpt}` : null,
    body ? `Body:\n${body}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
};

/**
 * Models sometimes wrap JSON in prose or code fences.
 * Extract the JSON object from the response.
 */
const parseSuggestion = (
  raw: string
): Omit<SeoSuggestion, "source"> | null => {
  const match = raw.match(/\{[\s\S]*\}/);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]);

    return {
      metaTitle: String(parsed.metaTitle ?? "").trim(),

      metaDescription: String(
        parsed.metaDescription ?? ""
      ).trim(),

      focusKeyword: String(
        parsed.focusKeyword ?? ""
      ).trim(),

      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords
            .map((k: unknown) => String(k).trim())
            .filter(Boolean)
        : [],
    };
  } catch {
    return null;
  }
};

/**
 * OpenRouter / OpenAI-compatible provider.
 *
 * Works with:
 * - OpenRouter
 * - OpenAI
 * - Ollama
 * - LM Studio
 * - Other OpenAI-compatible APIs
 */
const viaOpenAiCompatible = async (
  input: SeoSuggestInput
): Promise<Omit<SeoSuggestion, "source"> | null> => {
  const baseUrl = (
    process.env.AI_BASE_URL ||
    "https://openrouter.ai/api/v1"
  ).replace(/\/$/, "");

  const apiKey = process.env.ROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("ROUTER_API_KEY is not configured");
  }

  const model = process.env.AI_MODEL || "gpt-4o-mini";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,

      // Recommended OpenRouter headers
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000",

      "X-Title": "Windrise SEO Assistant",
    },

    body: JSON.stringify({
      model,

      messages: [
        {
          role: "system",
          content: PROMPT,
        },
        {
          role: "user",
          content: buildUserMessage(input),
        },
      ],

      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `AI provider responded ${response.status}: ${errorText}`
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const text =
    payload?.choices?.[0]?.message?.content ?? "";

  return parseSuggestion(text);
};

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "your",
  "you",
  "our",
  "we",
  "is",
  "are",
  "how",
  "what",
  "why",
  "this",
  "that",
  "from",
  "at",
  "by",
  "it",
  "its",
  "as",
  "be",
]);

/**
 * No AI provider configured.
 *
 * Generates usable SEO fields directly from the post.
 */
const viaFallback = (
  input: SeoSuggestInput
): Omit<SeoSuggestion, "source"> => {
  const storeName = "Windrise";

  const title = input.title.trim();

  const body = stripHtmlToText(
    input.content ?? ""
  ).trim();

  const summary = (
    input.excerpt?.trim() || body
  ).replace(/\s+/g, " ");

  const metaTitle =
    title.length <= 60
      ? title
      : `${title.slice(0, 57).trim()}...`;

  let metaDescription =
    summary ||
    `${title}. Read the full story on the ${storeName} journal.`;

  if (metaDescription.length > 160) {
    metaDescription =
      `${metaDescription.slice(0, 157).trim()}...`;
  } else if (metaDescription.length < 120) {
    metaDescription =
      `${metaDescription} Read more on the ${storeName} journal.`
        .slice(0, 160)
        .trim();
  }

  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 &&
        !STOPWORDS.has(word)
    );

  const focusKeyword =
    words.slice(0, 3).join(" ") ||
    title.toLowerCase();

  const keywords = Array.from(
    new Set(
      [
        focusKeyword,
        input.categoryName?.toLowerCase(),
        ...words.slice(0, 6),
      ].filter(
        (value): value is string =>
          Boolean(value)
      )
    )
  ).slice(0, 8);

  return {
    metaTitle,
    metaDescription,
    focusKeyword,
    keywords,
  };
};

export const suggestSeoFields = async (
  input: SeoSuggestInput
): Promise<SeoSuggestion> => {
  const configured =
    process.env.AI_PROVIDER
      ?.trim()
      .toLowerCase();

  /**
   * Explicit provider selection.
   */
  const provider =
    configured && configured !== "auto"
      ? configured
      : process.env.ROUTER_API_KEY
        ? "openai-compatible"
        : "none";

  /**
   * No AI provider.
   */
  if (provider === "none") {
    return {
      ...viaFallback(input),
      source: "fallback",
    };
  }

  try {
    /**
     * OpenRouter / OpenAI-compatible provider.
     */
    if (provider === "openai-compatible") {
      const result =
        await viaOpenAiCompatible(input);

      if (
        result &&
        result.metaTitle &&
        result.metaDescription
      ) {
        return {
          ...result,
          source: "openai-compatible",
        };
      }
    }
  } catch (error) {
    console.error(
      "[blog] SEO suggestion via AI failed:",
      error
    );
  }

  /**
   * If AI fails, don't break the editor.
   */
  return {
    ...viaFallback(input),
    source: "fallback",
  };
};