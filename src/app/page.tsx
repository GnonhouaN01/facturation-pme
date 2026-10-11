import { Button } from "@/components/ui/button";
import { TEXTES_COMMUNS } from "@/textes/commun";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <Button>{TEXTES_COMMUNS.produit}</Button>
    </main>
  );
}
