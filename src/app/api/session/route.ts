import { NextRequest, NextResponse } from "next/server";
import { connectDB, SessionModel } from "@/lib/db";
import { generateAndFundWallet } from "@/lib/xrpl/wallet";
import { hashPassword, verifyPassword, setAuthCookie } from "@/lib/auth";
import { redactSession } from "@/lib/session-public";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 6;

function sanitizeEmail(raw: unknown): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_REGEX.test(trimmed)) return null;
  return trimmed;
}

function validatePassword(raw: unknown): string | null {
  if (!raw || typeof raw !== "string") return null;
  if (raw.length < MIN_PASSWORD_LENGTH || raw.length > 128) return null;
  return raw;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = sanitizeEmail(body.email);
    const password = validatePassword(body.password);

    if (!email) {
      return NextResponse.json(
        { error: "A valid email address is required" },
        { status: 400 }
      );
    }

    if (!password) {
      return NextResponse.json(
        { error: `Password must be between ${MIN_PASSWORD_LENGTH} and 128 characters` },
        { status: 400 }
      );
    }

    await connectDB();

    const existing = await SessionModel.findOne({ email });
    if (existing) {
      // Login: verify password
      if (!verifyPassword(password, existing.passwordHash)) {
        return NextResponse.json(
          { error: "Invalid email or password" },
          { status: 401 }
        );
      }
      await setAuthCookie(existing._id.toString());
      return NextResponse.json({ session: redactSession(existing) });
    }

    // Register: create new account
    const roles = ["broker", "depositor", "borrower", "issuer"] as const;
    const wallets = await Promise.all(
      roles.map(async (role) => {
        const wallet = await generateAndFundWallet();
        return { ...wallet, role };
      })
    );

    const passwordHash = hashPassword(password);
    const session = await SessionModel.create({ email, wallets, passwordHash });
    await setAuthCookie(session._id.toString());

    return NextResponse.json({ session: redactSession(session) }, { status: 201 });
  } catch (error) {
    console.error("Session creation error:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}

// GET by email was removed — it returned the full session document
// (passwordHash + every wallet's seed/privateKey) to anyone who knew the
// email. Authenticated callers should use `GET /api/session/me`.
