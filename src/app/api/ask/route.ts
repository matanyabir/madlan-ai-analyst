import { NextResponse } from "next/server";
import { z } from "zod";
import { getSnapshot } from "@/lib/snapshot";
import { ask, QuestionError, MAX_QUESTION_LENGTH } from "@/lib/ask";
import { readAiPreference } from "@/lib/llm/aiPreference";
import { checkRate, clientKey, takeLlmQuestion } from "@/lib/llm/budget";

export const runtime = "nodejs";
/** Never statically cached: the answer depends on in-memory state. */
export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().min(1).max(MAX_QUESTION_LENGTH),
  skipCache: z.boolean().optional(),
});

export async function POST(request: Request) {
  // Before anything that costs money or memory. A caller in a loop is turned
  // away here; a caller within the burst but past the day's allowance is not
  // turned away at all — see the two guards in lib/llm/budget.ts.
  const rate = checkRate(clientKey(request));
  if (!rate.ok) {
    return NextResponse.json(
      { error: "יותר מדי שאלות בזמן קצר. נסו שוב בעוד רגע." },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "גוף הבקשה אינו JSON תקין" }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `שאלה לא תקינה — עד ${MAX_QUESTION_LENGTH} תווים` },
      { status: 400 },
    );
  }

  try {
    const answer = await ask(getSnapshot(), parsed.data.question, {
      skipCache: parsed.data.skipCache,
      useLlm: (await readAiPreference()) === "on",
      takeBudget: takeLlmQuestion,
    });
    return NextResponse.json(answer);
  } catch (err) {
    if (err instanceof QuestionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // Never leak an internal message or a stack to the client.
    console.error("[/api/ask]", err);
    return NextResponse.json(
      { error: "אירעה שגיאה בעיבוד השאלה. נסו שוב בעוד רגע." },
      { status: 500 },
    );
  }
}
