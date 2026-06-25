import GuideEditor from "@/components/GuideEditor";
import Navbar from "@/components/Navbar";
import { type ChannelKey } from "@/components/ChannelResultCard";
import { notFound } from "next/navigation";

const VALID_CHANNELS: ChannelKey[] = ["naver-blog", "instagram", "facebook", "linkedin", "magazine"];

export default async function GuideDetailPage({
  params,
}: {
  params: Promise<{ channel: string }>;
}) {
  const { channel } = await params;

  if (!VALID_CHANNELS.includes(channel as ChannelKey)) {
    notFound();
  }

  return (
    <div className="gradient-bg min-h-screen">
      <Navbar />
      <main className="pt-28 pb-20 px-4">
        <GuideEditor channel={channel as ChannelKey} />
      </main>
    </div>
  );
}
