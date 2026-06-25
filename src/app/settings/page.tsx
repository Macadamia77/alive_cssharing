import Navbar from "@/components/Navbar";
import SettingsPanel from "@/components/SettingsPanel";
import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="gradient-bg min-h-screen">
      <Navbar />
      <main className="pt-28 pb-20 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2.5 bg-slate-100 rounded-xl">
              <Settings className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">AI API 설정</h1>
              <p className="text-sm text-slate-500">콘텐츠 생성에 사용할 AI 제공사와 API 키를 설정합니다.</p>
            </div>
          </div>
          <SettingsPanel />
        </div>
      </main>
    </div>
  );
}
