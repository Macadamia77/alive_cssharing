export type ChannelKey = "naver-blog" | "instagram" | "facebook" | "linkedin" | "magazine";

export const CHANNELS: ChannelKey[] = [
  "naver-blog",
  "instagram",
  "facebook",
  "linkedin",
  "magazine",
];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  "naver-blog": "네이버 블로그",
  instagram: "인스타그램",
  facebook: "페이스북",
  linkedin: "링크드인",
  magazine: "홈페이지 매거진",
};

export const CHANNEL_COLORS: Record<
  ChannelKey,
  { color: string; bgColor: string; borderColor: string }
> = {
  "naver-blog": { color: "text-green-700", bgColor: "bg-green-50", borderColor: "border-green-200" },
  instagram: { color: "text-pink-600", bgColor: "bg-pink-50", borderColor: "border-pink-200" },
  facebook: { color: "text-blue-600", bgColor: "bg-blue-50", borderColor: "border-blue-200" },
  linkedin: { color: "text-sky-700", bgColor: "bg-sky-50", borderColor: "border-sky-200" },
  magazine: { color: "text-purple-700", bgColor: "bg-purple-50", borderColor: "border-purple-200" },
};

export const CHANNEL_DESCRIPTIONS: Record<ChannelKey, string> = {
  "naver-blog": "SEO 최적화 블로그 포스트 가이드 — 구조, 분량, 키워드 전략",
  instagram: "짧고 임팩트 있는 캡션 가이드 — 이모지, 해시태그, CTA",
  facebook: "B2B 커뮤니티 참여 가이드 — 정보성 + 참여 유도 콘텐츠",
  linkedin: "사고 리더십 전문 포스팅 가이드 — 데이터 기반, 권위 있는 어조",
  magazine: "홈페이지 심층 아티클 가이드 — 전문성, 리드 전환 중심",
};
