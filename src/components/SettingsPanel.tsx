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
  researchProvider: string;
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
function ProviderSection({ providerKey, state, options, onSaveSuccess }: {
  providerKey: ProviderKey;
  state: ProviderState;
  options?: string[]; // /api/models(=models.json) 기반 목록. 없으면 하드코딩 프리셋으로 폴백.
  onSaveSuccess?: () => void;
}) {
  const info = PROVIDER_INFO[providerKey];
  // 모델 목록은 models.json을 단일 소스로 사용(채널 파이프라인 설정과 동일). 로드 전엔 프리셋 폴백.
  const modelOptions = options && options.length ? options : info.models;
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [model, setModel] = useState(state.model || info.defaultModel);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
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
      onSaveSuccess?.();
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setConfirmDelete(false);
    try {
      await fetch("/api/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerKey }),
      });
      setApiKeyInput("");
      setTestResult(null);
      setSaveStatus("idle");
      onSaveSuccess?.();
    } finally {
      setDeleting(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const testBody: Record<string, string> = { provider: providerKey };
      if (apiKeyInput.trim()) testBody.apiKey = apiKeyInput.trim();
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testBody),
      });
      const data = await res.json() as { ok: boolean; message: string };
      setTestResult(data);
      // 테스트 성공 + 새 키가 입력된 경우 자동 저장
      if (data.ok && apiKeyInput.trim()) {
        await handleSave();
      }
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

      {/* Model — provider의 전 모델을 드롭다운으로. select는 입력값과 무관하게 항상 전체를 보여준다
          (input+datalist는 현재 텍스트로 필터링돼 한 개만 보이는 문제가 있어 select로 교체). */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">모델</label>
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer mb-1.5">
          {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
          {model && !modelOptions.includes(model) && <option value={model}>{model} (직접 지정)</option>}
        </select>
        {/* 빠른 선택 칩(선택된 모델 강조) */}
        <div className="flex flex-wrap gap-1.5">
          {modelOptions.map(m => (
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
        <p className="text-[11px] text-slate-400 mt-1.5">목록에 없는 새 모델은 <code className="bg-slate-100 px-1 rounded font-mono">data/models.json</code>에 추가하면 나타납니다.</p>
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

      {/* 삭제 확인 */}
      {confirmDelete && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl mb-3 bg-red-50 border border-red-200 text-red-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">연결된 API 키를 삭제하시겠습니까?</span>
          <button onClick={() => void handleDelete()}
            className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 cursor-pointer transition-colors">
            삭제
          </button>
          <button onClick={() => setConfirmDelete(false)}
            className="px-2.5 py-1 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer transition-colors">
            취소
          </button>
        </div>
      )}

      {/* 버튼 */}
      <div className="flex gap-2">
        <button onClick={handleTest} disabled={testing || saving || deleting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors">
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          {testing ? "테스트 중..." : "연결 테스트"}
        </button>
        <button onClick={handleSave} disabled={saving || deleting}
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 disabled:opacity-50 cursor-pointer transition-colors">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "저장 중..." : "저장"}
        </button>
        {state.apiKeySet && (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting || confirmDelete}
            className="p-2 rounded-xl border border-red-200 text-red-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 cursor-pointer transition-colors"
            title="API 키 삭제">
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ── 리서치 전용 provider (활성 provider와 독립 선택) ──────────
function ResearchProviderSection({ value, onSaveSuccess }: { value: string; onSaveSuccess?: () => void }) {
  const [selected, setSelected] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => setSelected(value), [value]);

  const handleSave = async (next: string) => {
    setSelected(next);
    setSaving(true);
    setSaveStatus("idle");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researchProvider: next }),
      });
      if (!res.ok) throw new Error();
      setSaveStatus("success");
      onSaveSuccess?.();
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-5 border border-slate-200">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-700">리서치 전용 provider</div>
        <p className="text-xs text-slate-400 mt-0.5">
          웹서치가 필요한 리서치 단계(research/research-voice/research-deep)만 활성 provider와 다른 AI로 돌립니다. writer·검수 등 나머지 단계엔 영향 없습니다.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={selected}
          disabled={saving}
          onChange={e => void handleSave(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 cursor-pointer">
          <option value="active">활성 provider 따름 (기본)</option>
          <option value="claude">Claude</option>
          <option value="gemini">Gemini</option>
        </select>
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        {saveStatus === "success" && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
        {saveStatus === "error" && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
      </div>
    </div>
  );
}

// ── 모델 목록 관리 (data/models.json 라이브 편집) ─────────────
function ModelListEditor({ initial, onSaved }: { initial: Record<string, string[]>; onSaved: () => void }) {
  const [lists, setLists] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // 편집 대상 provider 순서: 알려진 3개 우선 + initial에 있는 기타 키
  const providers = Array.from(new Set([
    ...(["claude", "openai", "gemini"] as string[]),
    ...Object.keys(initial),
  ]));

  useEffect(() => {
    const base: Record<string, string[]> = {};
    for (const p of providers) base[p] = initial[p] ? [...initial[p]] : [];
    setLists(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const setAt = (prov: string, i: number, val: string) =>
    setLists(l => ({ ...l, [prov]: (l[prov] ?? []).map((m, idx) => idx === i ? val : m) }));
  const removeAt = (prov: string, i: number) =>
    setLists(l => ({ ...l, [prov]: (l[prov] ?? []).filter((_, idx) => idx !== i) }));
  const addAt = (prov: string) =>
    setLists(l => ({ ...l, [prov]: [...(l[prov] ?? []), ""] }));

  const save = async () => {
    setSaving(true); setStatus("idle"); setErr(null);
    const cleaned: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(lists)) cleaned[k] = v.map(s => s.trim()).filter(Boolean);
    try {
      const r = await fetch("/api/models", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ models: cleaned }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "저장 실패");
      setStatus("ok"); setTimeout(() => setStatus("idle"), 2500);
      onSaved();
    } catch (e) {
      setStatus("err"); setErr(e instanceof Error ? e.message : "저장 실패");
    } finally { setSaving(false); }
  };

  const info = (p: string) => PROVIDER_INFO[p as ProviderKey] ?? null;

  return (
    <div className="glass-card rounded-2xl border border-slate-200 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-5 py-4 hover:bg-slate-50/50 cursor-pointer text-left">
        <span className="flex-1">
          <span className="block text-sm font-semibold text-slate-700">모델 목록 관리</span>
          <span className="block text-xs text-slate-400 mt-0.5">위 provider 모델 드롭다운과 채널 파이프라인 설정에 뜨는 목록(= data/models.json). 저장 즉시 반영됩니다.</span>
        </span>
        {status === "ok" && <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />}
        {open ? <span className="text-slate-400 text-xs">접기</span> : <span className="text-blue-600 text-xs font-medium">편집</span>}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-4">
          {providers.map(p => (
            <div key={p}>
              <div className="flex items-center gap-2 mb-1.5">
                {info(p) && <span className={`w-2 h-2 rounded-full ${info(p)!.dot}`} />}
                <span className={`text-xs font-semibold ${info(p)?.color ?? "text-slate-600"}`}>{info(p)?.label ?? p}</span>
                <span className="text-[10px] text-slate-400">{(lists[p] ?? []).length}개</span>
              </div>
              <div className="space-y-1.5">
                {(lists[p] ?? []).map((m, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      value={m}
                      onChange={e => setAt(p, i, e.target.value)}
                      placeholder="모델 ID (예: claude-sonnet-4-6)"
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                    <button onClick={() => removeAt(p, i)}
                      className="p-1.5 text-slate-400 hover:text-red-500 cursor-pointer shrink-0" title="삭제">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button onClick={() => addAt(p)}
                  className="text-xs text-blue-600 font-medium hover:text-blue-700 cursor-pointer">+ 모델 추가</button>
              </div>
            </div>
          ))}

          {err && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{err}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 cursor-pointer">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "저장 중..." : "모델 목록 저장"}
            </button>
            {status === "ok" && <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" />저장됨 — 드롭다운에 반영</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 메인 패널 ─────────────────────────────────────────────
export default function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({});

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json() as SettingsData;
      setSettings(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchSettings(); }, [fetchSettings]);

  // 모델 목록(provider별) — 채널 파이프라인 설정과 동일하게 /api/models(models.json) 단일 소스
  const fetchModels = useCallback(() => {
    return fetch("/api/models").then(r => r.json())
      .then(d => setModelsByProvider(d.models ?? {}))
      .catch(() => {});
  }, []);
  useEffect(() => { void fetchModels(); }, [fetchModels]);

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
              options={modelsByProvider[p]}
              onSaveSuccess={fetchSettings}
            />
          ))}
        </div>
      </div>

      {/* 리서치 전용 provider (활성 provider와 독립 선택) */}
      <ResearchProviderSection value={settings?.researchProvider ?? "active"} onSaveSuccess={fetchSettings} />

      {/* 모델 목록 관리 (data/models.json 라이브 편집) */}
      <ModelListEditor initial={modelsByProvider} onSaved={fetchModels} />

      {/* Mock 모드 안내 */}
      <div className="glass-card rounded-2xl p-4 bg-slate-50 border border-slate-200">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-slate-400" />
          <span className="text-sm font-semibold text-slate-600">Mock (테스트)</span>
          <span className="text-xs text-slate-400 bg-white px-2 py-0.5 rounded-full border border-slate-200">항상 사용 가능</span>
        </div>
        <p className="text-xs text-slate-500">API 키 없이 샘플 콘텐츠로 전체 흐름을 테스트합니다. 메인 페이지에서 선택 가능합니다.</p>
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
