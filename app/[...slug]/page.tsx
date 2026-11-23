import { notFound } from "next/navigation";
import Experience from "@/components/experience";
import { isKnownRoute } from "@/lib/routes";

export default async function ContentPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  if (!isKnownRoute(slug)) notFound();
  return <Experience />;
}
