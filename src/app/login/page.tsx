"use client";

// 매직링크 로그인 페이지. 이메일을 입력하면 Supabase가 일회용 로그인 링크를 이메일로 보낸다.
// shouldCreateUser:false → 미리 초대된(허용목록) 사용자만 로그인, 아무나 가입 차단.
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendLink() {
    setError("");
    setLoading(true);
    try {
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) setError(error.message);
      else setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", padding: 20, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>로그인</h1>
      {sent ? (
        <p style={{ lineHeight: 1.6 }}>
          입력하신 이메일로 <b>로그인 링크</b>를 보냈어요.<br />
          메일함(스팸함 포함)을 확인해 링크를 클릭하면 로그인됩니다.
        </p>
      ) : (
        <>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일 주소"
            onKeyDown={(e) => {
              if (e.key === "Enter" && email) sendLink();
            }}
            style={{
              width: "100%",
              padding: "10px 12px",
              marginBottom: 12,
              border: "1px solid #ccc",
              borderRadius: 8,
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={sendLink}
            disabled={loading || !email}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "none",
              background: loading || !email ? "#9bbcd6" : "#1e90d6",
              color: "#fff",
              fontWeight: 700,
              cursor: loading || !email ? "default" : "pointer",
            }}
          >
            {loading ? "보내는 중…" : "로그인 링크 받기"}
          </button>
          {error && <p style={{ color: "crimson", marginTop: 12, fontSize: 14 }}>{error}</p>}
        </>
      )}
    </main>
  );
}
