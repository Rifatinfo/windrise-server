import { envVars } from "../../../config";

/**
 * The model behind Windee, reached through OpenRouter.
 *
 * OpenRouter namespaces model ids by provider, so the plain "gpt-4o-mini" has
 * to be sent as "openai/gpt-4o-mini" or the request is rejected as an unknown
 * model. `CHATBOT_MODEL` overrides it without a code change.
 */
const MODEL = process.env.CHATBOT_MODEL ?? "openai/gpt-4o-mini";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** A tool loop that cannot terminate would bill on every pass. */
const MAX_TOOL_ROUNDS = 5;
const REQUEST_TIMEOUT_MS = 45_000;

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessageParam =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ChatContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type Completion = {
  choices: {
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }[];
  error?: { message?: string };
};

export const isConfigured = () => Boolean(envVars.ROUTER_API_KEY);

async function callModel(
  messages: ChatMessageParam[],
  tools: ToolSpec[],
): Promise<Completion["choices"][number]["message"]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${envVars.ROUTER_API_KEY}`,
        "Content-Type": "application/json",
        // OpenRouter attributes usage with these; harmless if unset.
        "HTTP-Referer": envVars.FRONTEND_URL ?? "http://localhost:3000",
        "X-Title": "Windrise Windee",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.3,
      }),
    });

    const body = (await res.json()) as Completion;

    if (!res.ok || body.error) {
      throw new Error(body.error?.message ?? `Model request failed (${res.status})`);
    }

    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("Model returned no message");
    return message;
  } finally {
    clearTimeout(timeout);
  }
}

export type ToolRunner = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ result: unknown; card?: unknown }>;

export type CompletionResult = {
  text: string;
  /** Structured payloads the tools produced, in the order they ran. */
  cards: { tool: string; data: unknown }[];
  /**
   * Every message appended while working, in order — the assistant turns that
   * requested tools and the tool results that answered them.
   *
   * These have to be persisted and replayed verbatim. Without them the model
   * starts each turn blind to the ids it was just working with and repeats
   * work it has already done.
   */
  turns: ChatMessageParam[];
};

/**
 * Runs one exchange to completion: the model may call tools, read their
 * results, and call more, until it produces prose for the visitor.
 *
 * The loop is bounded. If the model is still asking for tools on the last
 * round, its final answer is requested without them so the visitor always
 * receives a reply rather than a spinner that never resolves.
 */
export async function complete(
  messages: ChatMessageParam[],
  tools: ToolSpec[],
  runTool: ToolRunner,
): Promise<CompletionResult> {
  const thread = [...messages];
  const cards: CompletionResult["cards"] = [];
  const turns: ChatMessageParam[] = [];

  const append = (turn: ChatMessageParam) => {
    thread.push(turn);
    turns.push(turn);
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const isLastRound = round === MAX_TOOL_ROUNDS - 1;
    const message = await callModel(thread, isLastRound ? [] : tools);

    if (!message.tool_calls?.length) {
      return { text: message.content ?? "", cards, turns };
    }

    append({
      role: "assistant",
      content: message.content,
      tool_calls: message.tool_calls,
    });

    for (const call of message.tool_calls) {
      let output: string;

      try {
        const args = JSON.parse(call.function.arguments || "{}");
        const { result, card } = await runTool(call.function.name, args);
        output = JSON.stringify(result);
        if (card) cards.push({ tool: call.function.name, data: card });
      } catch (error) {
        // Handed back to the model rather than thrown: it can apologise or ask
        // for the missing detail, which is far better than a 500 mid-chat.
        output = JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Tool failed",
        });
      }

      append({ role: "tool", tool_call_id: call.id, content: output });
    }
  }

  return {
    text: "Sorry — I couldn't finish that one. Could you try rephrasing it?",
    cards,
    turns,
  };
}
