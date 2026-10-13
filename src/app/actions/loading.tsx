import { AppShell } from "@/components/shell/app-shell";
import { ItemLoading } from "@/components/items/item-loading";

export default function Loading() {
  return (
    <AppShell title="플래너" workspace demo>
      <ItemLoading />
    </AppShell>
  );
}
