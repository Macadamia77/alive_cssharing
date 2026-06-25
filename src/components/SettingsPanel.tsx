"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save, CheckCircle, AlertCircle, Loader2, Zap, Eye, EyeOff, ExternalLink, KeyRound, Trash2,
} from "lucide-react";

type ProviderKey = "claude" | "openai" | "gemini";

interface ProviderState {
  apiKeySet: boolean;
  apiKeyMasked: string;
  model: string;
}

interface SettingsData {
  activeProvider: string;
  providers: Record<ProviderKey, ProviderState>;
}

const PROVIDER_INFO: Record<ProviderKey, {
  label: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
  desc: string;
  models: string[];
  defaultModel: string;
  docsUrl: string;
}> = {
  claude: {
    label: "Claude (Anthropic)",
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-300",
    dot: "bg-orange-400",
    desc: "Anthropic의 Claude 모델을 사용합니다.",
    models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
    defaultModel: "claude-sonnet-4-6",
    docsUrl: "https://console.anthropic.com/",
  },
  openai: {
    label: "OpenAI",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-300",
    dot: "bg-emerald-400",
    desc: "OpenAI의 GPT 모델을 사용합니다.",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    defaultModel: "gpt-4o",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  gemini: {
    label: "Gemini (Google)",
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-300",
    dot: "bg-blue-400",
    desc: "Google의 Gemini 모델을 사용합니다.",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro"],
    defaultModel: "gemini-2.5-flash",
    docsUrl: "https://aistudio.google.com/app/apikey",
  },
};

// ── 개별 provider 섹션 ─────────────────────────────────────
function ProviderSection({ providerKey, state }: {
  providerKey: ProviderKey;
  state: ProviderState;
}) {
  const info = PROVIDER_INFO[providerKey];
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [model, setModel] = useState(state.model || info.defaultModel);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    setTestResult(null);
    try {
      const body: Record<string, string> = { provider: providerKey, model };
      if (apiKeyInput.trim()) body.apiKey = apiKeyInput.trim();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setSaveStatus("success");
      setApiKeyInput("");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (apiKeyInput.trim()) await handleSave();
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerKey }),
      });
      const data = await res.json() as { ok: boolean; message: string };
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, message: "연결 테스트 실패" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={`glass-card rounded-2xl p-5 border ${state.apiKeySet ? info.border : "border-slate-200"}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          {state.apiKeySet && <div className={`w-2 h-2 rounded-full ${info.dot}`} />}
          <div>
            <div className={`text-sm font-semibold ${state.apiKeySet ? info.color : "text-slate-700"}`}>
              {info.label}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{info.desc}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state.apiKeySet && (
            <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              ✓ 연결됨
            </span>
          )}
          <a href={info.docsUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors">
            API 키 발급 <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* API Key */}
      <div className="mb-3">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          API Key
          {state.apiKeySet && (
            <span className="ml-2 normal-case font-normal text-slate-400">
              ({state.apiKeyMasked})
            </span>
          )}
        </label>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
            placeholder={state.apiKeySet ? "변경하려면 새 키를 입력하세요" : "API 키를 입력하세요"}
            className="w-full pr-10 px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <button onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            aria-label={showKey ? "키 숨기기" : "키 보기"}>
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Model */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">모델</label>
        <input
          type="text"
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder={info.defaultModel}
          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white mb-1.5"
        />
        <div className="flex flex-wrap gap-1.5">
          {info.models.map(m => (
            <button key={m} onClick={() => setModel(m)}
              className={`px-2.5 py-1 rounded-lg text-xs border transition-colors cursor-pointer ${
                model === m
                  ? `${info.bg} ${info.border} border ${info.color} font-medium`
                  : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* 상태 메시지 */}
      {testResult && (
        <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3 ${
          testResult.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-100"
        }`}>
          {testResult.ok ? <CheckCircle className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          {testResult.message}
        </div>
      )}
      {saveStatus === "success" && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3 bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle className="w-3.5 h-3.5 shrink-0" />설정이 저장되었습니다.
        </div>
      )}
      {saveStatus === "error" && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3 bg-red-50 text-red-600 border border-red-100">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />저장에 실패했습니다.
        </div>
      )}

      {/* 버튼 */}
      <div className="flex gap-2">
        <button onClick={handleTest} disabled={testing || saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors">
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          {testing ? "테스트 중..." : "연결 테스트"}
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 disabled:opacity-50 cursor-pointer transition-colors">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}

// ── 메인 패널 ─────────────────────────────────────────────
export default function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);

  // GitHub 토큰 상태
  const [githubToken, setGithubToken] = useState("");
  const [githubStatus, setGithubStatus] = useState<{ ok: boolean; source: string | null } | null>(null);
  const [githubSaving, setGithubSaving] = useState(false);
  const [githubResult, setGithubResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showGithubToken, setShowGithubToken] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json() as SettingsData;
      setSettings(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchGithubStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/github");
      const data = await res.json() as { ok: boolean; source: string | null };
      setGithubStatus(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void fetchSettings(); void fetchGithubStatus(); }, [fetchSettings, fetchGithubStatus]);

  const handleSaveGithubToken = async () => {
    if (!githubToken.trim()) return;
    setGithubSaving(true);
    setGithubResult(null);
    try {
      const res = await fetch("/api/settings/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: githubToken.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setGithubResult({ ok: false, message: data.error ?? "저장 실패" });
      } else {
        setGithubResult({ ok: true, message: "GitHub 토큰이 저장되었습니다. 파일 저장/삭제가 가능합니다." });
        setGithubToken("");
        await fetchGithubStatus();
      }
    } catch {
      setGithubResult({ ok: false, message: "네트워크 오류가 발생했습니다." });
    } finally {
      setGithubSaving(false);
    }
  };

  const handleRemoveGithubToken = async () => {
    await fetch("/api/settings/github", { method: "DELETE" });
    setGithubResult(null);
    await fetchGithubStatus();
  };

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-8 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* AI 제공사 섹션 */}
      <div>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-slate-700">AI 제공사 설정</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            API 키를 저장한 제공사는 메인 페이지에서 선택해 사용할 수 있습니다.
          </p>
        </div>
        <div className="space-y-3">
          {(["claude", "openai", "gemini"] as ProviderKey[]).map(p => (
            <ProviderSection
              key={p}
              providerKey={p}
              state={settings?.providers[p] ?? { apiKeySet: false, apiKeyMasked: "", model: PROVIDER_INFO[p].defaultModel }}
            />
          ))}
        </div>
      </div>

      {/* Mock 모드 안내 */}
      <div className="glass-card rounded-2xl p-4 bg-slate-50 border border-slate-200">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-slate-400" />
          <span className="text-sm font-semibold text-slate-600">Mock (테스트)</span>
          <span className="text-xs text-slate-400 bg-white px-2 py-0.5 rounded-full border border-slate-200">항상 사용 가능</span>
        </div>
        <p className="text-xs text-slate-500">API 키 없이 샘플 콘텐츠로 전체 흐름을 테스트합니다. 메인 페이지에서 선택 가능합니다.</p>
      </div>

      {/* GitHub 연동 */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">GitHub 연동</h2>
          </div>
          {githubStatus?.ok && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              연동됨 {githubStatus.source === "env" ? "(서버 설정)" : "(직접 입력)"}
            </span>
          )}
          {githubStatus && !githubStatus.ok && (
            <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
              <AlertCircle className="w-3.5 h-3.5" />
              미연동 — 파일 저장 불가
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500">
          파일 저장·삭제·업로드를 사용하려면 GitHub Personal Access Token이 필요합니다.
          <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer"
            className="ml-1 text-blue-600 hover:underline inline-flex items-center gap-0.5">
            토큰 발급 <ExternalLink className="w-3 h-3" />
          </a>
          (repo 권한만 체크)
        </p>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showGithubToken ? "text" : "password"}
              value={githubToken}
              onChange={e => setGithubToken(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void handleSaveGithubToken()}
              placeholder={githubStatus?.ok ? "새 토큰으로 교체하려면 입력" : "ghp_xxxxxxxxxxxx"}
              className="w-full pr-10 px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <button onClick={() => setShowGithubToken(!showGithubToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
              {showGithubToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={() => void handleSaveGithubToken()} disabled={githubSaving || !githubToken.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-40 cursor-pointer transition-colors">
            {githubSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            저장
          </button>
          {githubStatus?.source === "cookie" && (
            <button onClick={() => void handleRemoveGithubToken()}
              className="p-2.5 rounded-xl border border-red-200 text-red-400 hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
              title="토큰 삭제">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {githubResult && (
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl ${githubResult.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-100"}`}>
            {githubResult.ok ? <CheckCircle className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
            {githubResult.message}
          </div>
        )}
      </div>

      {/* 콘텐츠 생성 흐름 안내 */}
      <div className="glass-card rounded-2xl p-5">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">콘텐츠 생성 흐름</h2>
        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
          <span className="px-2.5 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg font-medium">주제 입력</span>
          <span className="text-slate-400">→</span>
          <span className="px-2.5 py-1.5 bg-violet-50 border border-violet-200 text-violet-700 rounded-lg font-medium">AI 선택</span>
          <span className="text-slate-400">→</span>
          <span className="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg font-medium">채널별 가이드 로드</span>
          <span className="text-slate-400">→</span>
          <span className="px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg font-medium">5개 채널 콘텐츠</span>
        </div>
        <p className="mt-3 text-xs text-slate-500 leading-relaxed">
          메인 페이지에서 사용할 AI를 선택하면, 해당 AI로 초안 추천과 채널 콘텐츠를 모두 생성합니다.
        </p>
      </div>
    </div>
  );
}
