"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save, CheckCircle, AlertCircle, Loader2, Zap, Eye, EyeOff, ExternalLink,
} from "lucide-react";

type Provider = "mock" | "claude" | "openai";

interface SettingsState {
  provider: Provider;
  model: string;
  apiKey: string;
  apiKeySet: boolean;
  apiKeyMasked: string;
}

const PROVIDER_INFO = {
  mock: {
    label: "Mock (테스트)",
    color: "text-slate-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
    desc: "실제 API 없이 샘플 콘텐츠로 테스트합니다.",
    models: [],
    modelPlaceholder: "사용 안 함",
    docsUrl: "",
  },
  claude: {
    label: "Claude (Anthropic)",
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
    desc: "Anthropic의 Claude 모델을 사용합니다.",
    models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
    modelPlaceholder: "claude-sonnet-4-6",
    docsUrl: "https://console.anthropic.com/",
  },
  openai: {
    label: "OpenAI",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    desc: "OpenAI의 GPT 모델을 사용합니다.",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    modelPlaceholder: "gpt-4o",
    docsUrl: "https://platform.openai.com/api-keys",
  },
};

export default function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsState>({
    provider: "mock", model: "", apiKey: "", apiKeySet: false, apiKeyMasked: "",
  });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    setTestResult(null);
    try {
      const body: Record<string, string> = {
        provider: settings.provider,
        model: settings.model,
      };
      if (apiKeyInput.trim()) body.apiKey = apiKeyInput.trim();

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setSaveStatus("success");
      setApiKeyInput("");
      await fetchSettings();
      setTimeout(() => setSaveStatus("idle"), 4000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    // 먼저 저장
    if (apiKeyInput.trim() || settings.provider !== (await fetch("/api/settings").then(r => r.json()).then(d => d.provider))) {
      await handleSave();
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings", { method: "POST" });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, message: "연결 테스트 실패" });
    } finally {
      setTesting(false);
    }
  };

  const info = PROVIDER_INFO[settings.provider];

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto glass-card rounded-2xl p-8 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* AI Provider 선택 */}
      <div className="glass-card rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">AI 제공사 선택</h2>
        <div className="grid grid-cols-3 gap-3">
          {(["mock", "claude", "openai"] as Provider[]).map((p) => {
            const pi = PROVIDER_INFO[p];
            const active = settings.provider === p;
            return (
              <button
                key={p}
                onClick={() => { setSettings(s => ({ ...s, provider: p })); setTestResult(null); }}
                className={`
                  p-4 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer
                  ${active ? `${pi.border} ${pi.bg}` : "border-slate-200 bg-white hover:border-slate-300"}
                `}
                aria-pressed={active}
              >
                <div className={`text-sm font-semibold mb-1 ${active ? pi.color : "text-slate-700"}`}>
                  {pi.label}
                </div>
                <div className="text-xs text-slate-500 leading-snug">{pi.desc}</div>
                {active && <div className={`mt-2 w-2 h-2 rounded-full ${p === "mock" ? "bg-slate-400" : p === "claude" ? "bg-orange-400" : "bg-emerald-400"}`} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* API 키 & 모델 */}
      {settings.provider !== "mock" && (
        <div className="glass-card rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">API 설정</h2>
            {info.docsUrl && (
              <a href={info.docsUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 cursor-pointer">
                API 키 발급 <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              API Key
              {settings.apiKeySet && (
                <span className="ml-2 normal-case font-normal text-emerald-600">
                  ✓ 저장됨 ({settings.apiKeyMasked})
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={settings.apiKeySet ? "변경하려면 새 키를 입력하세요" : "API 키를 입력하세요"}
                className="w-full pr-10 px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label={showKey ? "키 숨기기" : "키 보기"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">모델</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.model}
                onChange={(e) => setSettings(s => ({ ...s, model: e.target.value }))}
                placeholder={info.modelPlaceholder}
                className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {info.models.map(m => (
                <button key={m} onClick={() => setSettings(s => ({ ...s, model: m }))}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition-colors cursor-pointer ${settings.model === m ? "bg-blue-50 border-blue-300 text-blue-700 font-medium" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 연결 흐름 안내 */}
      <div className="glass-card rounded-2xl p-5">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">콘텐츠 생성 흐름</h2>
        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
          <span className="px-2.5 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg font-medium">주제 입력</span>
          <span className="text-slate-400">→</span>
          <span className="px-2.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg font-medium">채널별 가이드 로드</span>
          <span className="text-slate-400">→</span>
          <span className={`px-2.5 py-1.5 ${info.bg} ${info.border} border ${info.color} rounded-lg font-medium`}>{info.label} API</span>
          <span className="text-slate-400">→</span>
          <span className="px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg font-medium">5개 채널 콘텐츠</span>
        </div>
        {settings.provider !== "mock" && (
          <p className="mt-3 text-xs text-slate-500 leading-relaxed">
            채널별 가이드 파일이 시스템 프롬프트로 자동 합산되어 {info.label}에 전달됩니다.
            각 채널에 맞는 지침대로 AI가 독립적으로 콘텐츠를 생성합니다.
          </p>
        )}
      </div>

      {/* 테스트 결과 */}
      {testResult && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl text-sm fade-in ${testResult.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-red-50 border border-red-100 text-red-700"}`} role="status">
          {testResult.ok ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          {testResult.message}
        </div>
      )}

      {saveStatus === "success" && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 fade-in" role="status">
          <CheckCircle className="w-4 h-4 shrink-0" />
          설정이 저장되었습니다. 다음 콘텐츠 생성부터 즉시 반영됩니다.
        </div>
      )}

      {saveStatus === "error" && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm bg-red-50 border border-red-100 text-red-700" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0" />
          저장에 실패했습니다. 다시 시도해주세요.
        </div>
      )}

      {/* 버튼 */}
      <div className="flex gap-3">
        <button
          onClick={handleTest}
          disabled={testing || saving}
          className="flex items-center gap-2 px-5 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {testing ? "테스트 중..." : "연결 테스트"}
        </button>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 cursor-pointer transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "저장 중..." : "설정 저장"}
        </button>
      </div>
    </div>
  );
}
