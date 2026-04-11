import { NextRequest, NextResponse } from "next/server";
import { connectDB, SessionModel } from "@/lib/db";
import { generateAndFundWallet } from "@/lib/xrpl/wallet";
import { hashPassword, verifyPassword, setAuthCookie } from "@/lib/auth";

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
      return NextResponse.json({ session: existing });
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

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("Session creation error:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get("email");
    const email = sanitizeEmail(raw);

    if (!email) {
      return NextResponse.json(
        { error: "A valid email address is required" },
        { status: 400 }
      );
    }

    await connectDB();

    const session = await SessionModel.findOne({ email });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error("Session fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch session" },
      { status: 500 }
    );
  }
}
