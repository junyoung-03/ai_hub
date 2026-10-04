import Link from "next/link";

export default function NotFound() {
  return <main className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-xl font-semibold">자료를 찾을 수 없습니다</h1><p className="text-sm text-muted-foreground">주소를 확인하거나 Library에서 자료를 선택해 주세요.</p><Link href="/library" className="underline">Library로 돌아가기</Link></main>;
}
