import mongoose, { Schema } from "mongoose";

const walletSchema = new Schema(
  {
    address: { type: String, required: true },
    publicKey: { type: String, required: true },
    privateKey: { type: String, required: true },
    seed: { type: String, required: true },
    role: {
      type: String,
      enum: ["broker", "depositor", "borrower", "issuer"],
      required: true,
    },
    balance: { type: String },
  },
  { _id: false }
);

const sessionSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    wallets: { type: [walletSchema], required: true },
    vaultId: { type: String },
    loanBrokerId: { type: String },
    issuedToken: {
      type: { type: String, enum: ["IOU", "MPT"] },
      currency: { type: String },
      issuer: { type: String },
      mptIssuanceId: { type: String },
    },
  },
  { timestamps: true }
);

export const SessionModel =
  mongoose.models.Session || mongoose.model("Session", sessionSchema);
