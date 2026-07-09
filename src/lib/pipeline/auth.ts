// Provider 인증 해석 + 검색-불가 provider 자동 폴백 — runPipeline.ts에서 추출(M5 리팩터, 동작 무변화).
// 채널에 묶인 runPipeline뿐 아니라, 채널 없는 워커 잡(브레인스토밍 등)도 동일한 인증/폴백
// 로직을 재사용하기 위해 별도 모듈로 분리한다.
import { loadAIConfig, type Provider, type ProviderKey } from "../aiConfig";
import { DEFAULT_MODELS } from "../resolveProvider";

export interface AuthResult { apiKey: string; model: string }
export interface StageAuth { p: Provider; apiKey: string; model: string }

/**
 * token/baseProvider/apiKeyOverride에 묶인 인증 해석기를 만든다.
 * - resolveAuth(p): provider p의 키/모델 해석(env → GitHub 설정 → apiKeyOverride는 baseProvider에만).
 * - resolveModelFor(opts): 단계별 provider/modelId 오버라이드 해석. useSearch 단계인데 요청
 *   provider가 검색 불가(openai)면 검색 가능한 provider(gemini 우선, 없으면 claude)로 자동
 *   폴백한다. 폴백 시 modelId는 승계하지 않는다(교차-프로바이더 크래시 방지).
 */
export function createAuthResolver(
  token: string | undefined,
  baseProvider: Provider,
  apiKeyOverride?: string,
  modelOverride?: string
) {
  const cache = new Map<string, AuthResult | null>();

  const resolveAuth = async (p: Provider): Promise<AuthResult | null> => {
    if (cache.has(p)) return cache.get(p)!;
    const eKey = process.env[`${p.toUpperCase()}_API_KEY`]?.trim();
    const eModel = process.env[`${p.toUpperCase()}_MODEL`]?.trim();
    let pc = eKey ? { apiKey: eKey, model: eModel || DEFAULT_MODELS[p as ProviderKey] } : null;
    if (!pc) pc = await loadAIConfig(token).then(c => c.providers[p as ProviderKey]).catch(() => null);
    if (p === baseProvider && apiKeyOverride) pc = { apiKey: apiKeyOverride, model: pc?.model || eModel || DEFAULT_MODELS[p as ProviderKey] };
    const result = pc?.apiKey ? { apiKey: pc.apiKey, model: pc.model || DEFAULT_MODELS[p as ProviderKey] } : null;
    cache.set(p, result);
    return result;
  };

  const resolveModelFor = async (opts: {
    model?: string; modelId?: string; useSearch?: boolean; stageId?: string;
  }): Promise<StageAuth> => {
    let requested = (opts.model as Provider) || baseProvider;
    let forcedModel = opts.modelId;
    // 브라우저에서 고른 모델(활성 provider용)을 이 단계에 강제 적용 — 단, 이 단계가 baseProvider가
    // 아닌 다른 provider로 도는 경우(연구 provider 독립선택 등)는 모델 텍스트가 안 맞을 수 있으니
    // 건너뛴다. pipeline.json에 단계별 modelId가 명시돼 있으면 그게 더 구체적이므로 그걸 우선한다.
    if (!forcedModel && modelOverride && requested === baseProvider) forcedModel = modelOverride;
    if (opts.useSearch && requested !== "claude" && requested !== "gemini") {
      const fb: Provider | null = (await resolveAuth("gemini")) ? "gemini"
        : (await resolveAuth("claude")) ? "claude" : null;
      if (fb) {
        console.log(`[engine] ${opts.stageId ?? "stage"}: '${requested}'는 웹검색 불가 → '${fb}'로 리서치 폴백`);
        requested = fb;
        forcedModel = undefined;
      }
    }
    const a = await resolveAuth(requested);
    if (a) return { p: requested, apiKey: a.apiKey, model: forcedModel || a.model };
    throw new Error(
      `이 단계는 '${requested}' 모델로 설정됐지만 워커에 ${requested.toUpperCase()}_API_KEY가 없습니다. ` +
      `Railway(및 Vercel) 환경변수에 ${requested.toUpperCase()}_API_KEY를 추가하거나, ` +
      `파이프라인 카드에서 이 단계/채널 모델을 '기본'으로 되돌리세요.`
    );
  };

  return { resolveAuth, resolveModelFor };
}
