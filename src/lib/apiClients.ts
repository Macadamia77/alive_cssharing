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
  const data = await res.json() as { content?: Array<{ type: string; text: string }> };
  const block = data.content?.[0];
  if (block?.type === "text") return block.text;
  throw new Error("Claude API 응답 형식 오류");
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
