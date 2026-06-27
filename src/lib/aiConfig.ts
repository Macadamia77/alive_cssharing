import fs from "fs/promises";
import path from "path";
import { isVercelProd, githubRead } from "./githubStorage";

const CONFIG_PATH = path.join(process.cwd(), "data", "ai-config.json");
const GH_CONFIG_PATH = "data/ai-config.json";

export type ProviderKey = "claude" | "openai" | "gemini";
export type Provider = "mock" | ProviderKey;

export interface ProviderConfig {
  apiKey: string;
  model: string;
}

export interface AIConfig {
  activeProvider: Provider;
  providers: Record<ProviderKey, ProviderConfig>;
}

const DEFAULT_MODELS: Record<ProviderKey, string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.5-flash",
};

function defaultConfig(): AIConfig {
  return {
    activeProvider: "mock",
    providers: {
      claude: { apiKey: "", model: DEFAULT_MODELS.claude },
      openai: { apiKey: "", model: DEFAULT_MODELS.openai },
      gemini: { apiKey: "", model: DEFAULT_MODELS.gemini },
    },
  };
}

function migrateOldConfig(old: Record<string, string>): AIConfig {
  const config = defaultConfig();
  const p = old.provider;
  if (p && p !== "mock" && old.apiKey && p in config.providers) {
    const pk = p as ProviderKey;
    config.providers[pk].apiKey = old.apiKey;
    if (old.model) config.providers[pk].model = old.model;
    config.activeProvider = pk;
  }
  return config;
}

export async function loadAIConfig(token?: string): Promise<AIConfig> {
  try {
    let raw: string;
    if (isVercelProd()) {
      // 토큰을 전달해 프라이빗 레포에서도 읽을 수 있게 하고,
      // 토큰 없이 읽으면 빈 config가 반환돼 기존 키가 덮어쓰이는 버그 방지
      raw = await githubRead(GH_CONFIG_PATH, token);
    } else {
      raw = await fs.readFile(CONFIG_PATH, "utf-8");
    }
    const parsed = JSON.parse(raw.replace(/^﻿/, "")) as Record<string, unknown>;

    // 구 단일 provider 포맷 자동 마이그레이션
    if ("provider" in parsed && !("providers" in parsed)) {
      return migrateOldConfig(parsed as Record<string, string>);
    }

    // 신 포맷: defaults와 병합 (누락 필드 보완)
    const config = defaultConfig();
    if (parsed.activeProvider) config.activeProvider = parsed.activeProvider as Provider;
    const providers = parsed.providers as Record<string, Record<string, string>> | undefined;
    for (const p of ["claude", "openai", "gemini"] as ProviderKey[]) {
      if (providers?.[p]?.apiKey) config.providers[p].apiKey = providers[p].apiKey;
      if (providers?.[p]?.model) config.providers[p].model = providers[p].model;
    }
    return config;
  } catch {
    return defaultConfig();
  }
}

export async function saveAIConfig(config: AIConfig, token?: string): Promise<void> {
  const { githubWrite } = await import("./githubStorage");
  // API 키는 GitHub/로컬 파일에 저장하지 않음 — 쿠키 또는 Vercel 환경변수로만 관리
  const safeConfig: AIConfig = {
    activeProvider: config.activeProvider,
    providers: {
      claude: { apiKey: "", model: config.providers.claude.model },
      openai: { apiKey: "", model: config.providers.openai.model },
      gemini: { apiKey: "", model: config.providers.gemini.model },
    },
  };
  const json = JSON.stringify(safeConfig, null, 2);
  if (isVercelProd()) {
    await githubWrite(GH_CONFIG_PATH, json, token);
    return;
  }
  await fs.writeFile(CONFIG_PATH, json, "utf-8");
}
