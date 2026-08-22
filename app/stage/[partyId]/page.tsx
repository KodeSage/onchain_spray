import StageClient from "./StageClient";

export default async function StagePage({
  params,
  searchParams,
}: {
  params: Promise<{ partyId: string }>;
  searchParams: Promise<{ demo?: string }>;
}) {
  const { partyId } = await params;
  const { demo } = await searchParams;
  const id = Number.parseInt(partyId, 10);

  return (
    <StageClient
      partyId={Number.isFinite(id) && id >= 0 ? id : 0}
      demo={demo === "1"}
    />
  );
}
