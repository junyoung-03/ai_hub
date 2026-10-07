import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { createManualItem, ManualItemError } from "@/lib/items/manual";

export const runtime = "nodejs";

const reply = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
  });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return reply({ error: { code: "FORBIDDEN", message: "허용되지 않은 요청입니다." } }, 403);
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reply({ error: { code: "VALIDATION_ERROR", message: "유효하지 않은 요청 본문입니다." } }, 400);
    }

    const result = await createManualItem(body);
    return reply(
      {
        itemId: result.itemId,
        item: result.item,
        analysisStatus: "queued",
      },
      201
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return reply({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
    }
    if (error instanceof ManualItemError) {
      const message =
        error.code === "VALIDATION_ERROR"
          ? "내용을 입력해 주세요. 공백만 있거나 100,000자를 초과할 수 없습니다."
          : "자료를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      return reply({ error: { code: error.code, message } }, error.status);
    }
    return reply({ error: { code: "INTERNAL_ERROR", message: "자료를 저장하지 못했습니다." } }, 500);
  }
}
