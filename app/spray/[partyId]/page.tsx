import SprayClient from "./SprayClient";

export default async function SprayPage({
  params,
}: {
  params: Promise<{ partyId: string }>;
}) {
  const { partyId } = await params;
  const id = Number.parseInt(partyId, 10);

  if (!Number.isFinite(id) || id < 0) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-8">
        <p className="t-meta">that party id is not a number</p>
      </main>
    );
  }

  return <SprayClient partyId={id} />;
}
