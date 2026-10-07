import { AppShell } from "@/components/shell/app-shell";
import { ItemLoading } from "@/components/items/item-loading";

export default function Loading() {
  return (
    <AppShell title="흩어진 정보, 한 번에 검색">
      <ItemLoading />
    </AppShell>
  );
}
