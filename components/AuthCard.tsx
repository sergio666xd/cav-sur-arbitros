export default function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-white text-3xl shadow-lg">🏐</div>
          <h1 className="text-2xl font-bold">Árbitros CAV-Sur</h1>
          <p className="text-sm text-brand-100">Gestión arbitral de voleibol</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mb-5 text-sm text-stone-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
