import { AppShell } from "@/components/shell/app-shell";
import { ItemLoading } from "@/components/items/item-loading";

export default function Loading() {
  return (
    <AppShell title="할 일">
      <ItemLoading />
    </AppShell>
  );
}
