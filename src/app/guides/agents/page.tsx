import SharedAgentEditor from "@/components/SharedAgentEditor";
import Navbar from "@/components/Navbar";

export default function SharedAgentsPage() {
  return (
    <div className="gradient-bg min-h-screen">
      <Navbar />
      <main className="pt-28 pb-20 px-4">
        <SharedAgentEditor />
      </main>
    </div>
  );
}
