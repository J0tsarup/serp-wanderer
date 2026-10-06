import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkKeyword, HALT_AFTER_CONSECUTIVE_FAILURES } from "@/lib/rank";
import { getSessionUser } from "@/lib/auth";

// Never statically prerendered — this route always reads/writes live
// database state, and some deployments run before the schema migration
// that adds newer columns has been applied, which would otherwise break
// the production build.
export const dynamic = "force-dynamic";

// Checking several selected keywords, each potentially paging deep into
// Google's results, can take a while — give it real room.
export const maxDuration = 300;

type Action =
  | "check"
  | "clear-errors"
  | "remove"
  | "duplicate"
  | "duplicate-flip-device"
  | "add-tags"
  | "remove-tags"
  | "set-device"
  | "move-domain";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const requestedIds = body?.ids as string[] | undefined;
  const action = body?.action as Action | undefined;

  if (!requestedIds?.length || !action) {
    return NextResponse.json({ error: "ids and action are required" }, { status: 400 });
  }

  // Silently narrow to only keywords the caller actually owns — a stale or
  // tampered id list can't touch anyone else's data.
  const owned = await prisma.keyword.findMany({
    where: { id: { in: requestedIds }, domain: { userId: user.id } },
  });
  const ids = owned.map((k) => k.id);
  if (ids.length === 0) {
    return NextResponse.json({ error: "None of the selected keywords were found" }, { status: 404 });
  }

  switch (action) {
    case "remove": {
      const result = await prisma.keyword.deleteMany({ where: { id: { in: ids } } });
      return NextResponse.json({ removed: result.count });
    }

    case "check": {
      const outcomes = [];
      let failStreak = 0;
      let halted: string | null = null;
      for (const id of ids) {
        const outcome = await checkKeyword(id);
        outcomes.push(outcome);
        failStreak = outcome.error && outcome.systemic ? failStreak + 1 : 0;
        if (failStreak >= HALT_AFTER_CONSECUTIVE_FAILURES) {
          halted = `Stopped after ${failStreak} failed checks in a row — last error: ${outcome.error}`;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return NextResponse.json({ checked: outcomes.length, outcomes, halted });
    }

    case "clear-errors": {
      // Deletes failed-check records only, so each row falls back to its last
      // real result. Successful history is untouched.
      const result = await prisma.rankCheck.deleteMany({ where: { keywordId: { in: ids }, error: { not: null } } });
      return NextResponse.json({ cleared: result.count });
    }

    case "duplicate":
    case "duplicate-flip-device": {
      const created = await prisma.keyword.createMany({
        data: owned.map((k) => ({
          domainId: k.domainId,
          term: k.term,
          country: k.country,
          language: k.language,
          device:
            action === "duplicate-flip-device" ? (k.device === "mobile" ? "desktop" : "mobile") : k.device,
          location: k.location,
          tags: k.tags,
        })),
      });
      return NextResponse.json({ duplicated: created.count });
    }

    case "add-tags": {
      const tags = (body?.tags as string[] | undefined)?.map((t) => t.trim()).filter(Boolean) ?? [];
      if (tags.length === 0) return NextResponse.json({ error: "tags are required" }, { status: 400 });

      await prisma.$transaction(
        owned.map((k) =>
          prisma.keyword.update({
            where: { id: k.id },
            data: { tags: Array.from(new Set([...k.tags, ...tags])) },
          })
        )
      );
      return NextResponse.json({ updated: owned.length });
    }

    case "remove-tags": {
      const tags = (body?.tags as string[] | undefined)?.map((t) => t.trim()).filter(Boolean) ?? [];
      if (tags.length === 0) return NextResponse.json({ error: "tags are required" }, { status: 400 });

      await prisma.$transaction(
        owned.map((k) =>
          prisma.keyword.update({
            where: { id: k.id },
            data: { tags: k.tags.filter((t) => !tags.includes(t)) },
          })
        )
      );
      return NextResponse.json({ updated: owned.length });
    }

    case "set-device": {
      const device = body?.device === "mobile" ? "mobile" : "desktop";
      const result = await prisma.keyword.updateMany({ where: { id: { in: ids } }, data: { device } });
      return NextResponse.json({ updated: result.count });
    }

    case "move-domain": {
      const targetDomainId = body?.targetDomainId as string | undefined;
      if (!targetDomainId) return NextResponse.json({ error: "targetDomainId is required" }, { status: 400 });

      const target = await prisma.domain.findUnique({ where: { id: targetDomainId } });
      if (!target || target.userId !== user.id) {
        return NextResponse.json({ error: "Target domain not found" }, { status: 404 });
      }

      const result = await prisma.keyword.updateMany({ where: { id: { in: ids } }, data: { domainId: targetDomainId } });
      return NextResponse.json({ moved: result.count });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
