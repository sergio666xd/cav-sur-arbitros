export default function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-night bg-[radial-gradient(ellipse_at_top,rgba(246,90,3,0.25),transparent_60%)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 animate-fade-in text-center text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/vertical-negativo.svg" alt="CAV.SUR" className="mx-auto mb-4 h-36 w-auto" />
          <p className="text-sm text-white/70">Gestión arbitral de voleibol</p>
        </div>
        <div className="animate-slide-up rounded-2xl bg-white p-6 shadow-xl" style={{ animationDelay: "80ms" }}>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mb-5 text-sm text-stone-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
