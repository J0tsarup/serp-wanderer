import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import crypto from "crypto";
import { hashPassword, createSession } from "@/lib/auth";

function codesMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const username = (body?.username as string | undefined)?.trim().toLowerCase();
  const password = body?.password as string | undefined;
  const inviteCode = ((body?.inviteCode as string | undefined) ?? "").trim();

  // Signup is invite-only. SIGNUP_INVITE_CODE is set in the deployment's
  // environment (kept out of the repo). If it isn't set, only the very first
  // account can be created — so a forgotten env var never reopens signup.
  const expectedCode = process.env.SIGNUP_INVITE_CODE?.trim();
  if (expectedCode) {
    if (!codesMatch(inviteCode, expectedCode)) {
      return NextResponse.json({ error: "That invite code isn't valid" }, { status: 403 });
    }
  } else if ((await prisma.user.count()) > 0) {
    return NextResponse.json({ error: "Signups are closed on this deployment" }, { status: 403 });
  }

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }
  if (!/^[a-z0-9_.@+-]{3,64}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3-64 characters: letters, numbers, and _ . @ + -" },
      { status: 400 }
    );
  }
  if (password.length < 5) {
    return NextResponse.json({ error: "Password must be at least 5 characters" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
  }

  // The very first account on a fresh deployment automatically inherits any
  // pre-existing domains/settings created before auth was added — so
  // upgrading an already-deployed single-user instance doesn't strand data.
  const isFirstUser = (await prisma.user.count()) === 0;

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { username, passwordHash } });

  if (isFirstUser) {
    await prisma.domain.updateMany({ where: { userId: null }, data: { userId: user.id } });
    await prisma.settings.updateMany({ where: { userId: null }, data: { userId: user.id } });
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true }, { status: 201 });
}
