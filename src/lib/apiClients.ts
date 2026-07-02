export async function callClaude(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, maxTokens = 8192
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Claude API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json() as {
    content?: Array<{ type: string; text: string }>;
    stop_reason?: string;
  };
  if (data.stop_reason === "max_tokens") {
    console.warn(`[apiClients] callClaude: max_tokens(${maxTokens})에 도달해 응답이 잘렸습니다.`);
  }
  const block = data.content?.[0];
  if (block?.type === "text") return block.text;
  throw new Error("Claude API 응답 형식 오류");
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; name?: string };
  delta?: { type: string; text?: string };
}

/**
 * Claude 네이티브 web_search 툴을 사용해 실제 검색 기반으로 응답을 생성한다.
 * 스트리밍 응답을 직접 파싱해 검색 시작 시점마다 onSearchStart를 호출한다.
 * 스트리밍/검색이 어떤 이유로든 실패하면 검색 없는 callClaude로 폴백한다 —
 * 리서치 단계가 도구 실패 때문에 전체 파이프라인을 막아서는 안 되기 때문.
 */
export async function callClaudeWithNativeSearch(
  apiKey: string, model: string, systemPrompt: string, userMessage: string,
  maxTokens = 8192, onSearchStart?: (queryCountSoFar: number) => void
): Promise<string> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        stream: true,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Claude API (web_search) 오류 (HTTP ${res.status})`);
    }

    let text = "";
    let searchCount = 0;
    const blockTypes = new Map<number, string>();
    let buffer = "";

    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += Buffer.from(chunk).toString("utf-8");
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const eventBlock of events) {
        const dataLine = eventBlock.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) continue;
        const jsonStr = dataLine.slice(5).trim();
        if (!jsonStr) continue;

        let event: AnthropicStreamEvent;
        try {
          event = JSON.parse(jsonStr) as AnthropicStreamEvent;
        } catch {
          continue;
        }

        if (event.type === "content_block_start" && typeof event.index === "number" && event.content_block) {
          blockTypes.set(event.index, event.content_block.type);
          if (event.content_block.type === "server_tool_use" && event.content_block.name === "web_search") {
            searchCount++;
            onSearchStart?.(searchCount);
          }
        } else if (event.type === "content_block_delta" && typeof event.index === "number") {
          const blockType = blockTypes.get(event.index);
          if (blockType === "text" && event.delta?.type === "text_delta" && event.delta.text) {
            text += event.delta.text;
          }
        }
      }
    }

    if (!text.trim()) throw new Error("Claude API (web_search) 응답이 비어 있습니다.");
    return text;
  } catch (e) {
    console.warn(`[apiClients] callClaudeWithNativeSearch 실패 — 검색 없이 폴백: ${e instanceof Error ? e.message : e}`);
    return callClaude(apiKey, model, systemPrompt, userMessage, maxTokens);
  }
}

export async function callOpenAI(
  apiKey: string, model: string, systemPrompt: string, userMessage: string
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `OpenAI API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (text) return text;
  throw new Error("OpenAI API 응답 형식 오류");
}

export async function callGemini(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, maxTokens = 8192, disableThinking = false
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const generationConfig: Record<string, unknown> = { maxOutputTokens: maxTokens };
  if (disableThinking && model.includes("2.5-flash")) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini API 오류 (HTTP ${res.status})`);
  }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? "").join("").trim();
  if (text) return text;
  throw new Error("Gemini API 응답 형식 오류");
}

export async function callGeminiWithSearch(
  apiKey: string, model: string, systemPrompt: string, userMessage: string, disableThinking = false
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const generationConfig: Record<string, unknown> = { maxOutputTokens: 8192 };
  if (disableThinking && model.includes("2.5-flash")) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      tools: [{ googleSearch: {} }],
      generationConfig,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini API (Google Search) 오류 (HTTP ${res.status})`);
  }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? "").join("").trim();
  if (text) return text;

  return callGemini(apiKey, model, systemPrompt, userMessage, 8192);
}
