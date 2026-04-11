import mongoose from "mongoose";

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI environment variable is required");
const MONGODB_URI: string = process.env.MONGODB_URI;

const cached = global as typeof globalThis & {
  mongoose: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
};

if (!cached.mongoose) {
  cached.mongoose = { conn: null, promise: null };
}

export async function connectDB() {
  if (cached.mongoose.conn) return cached.mongoose.conn;
  if (!cached.mongoose.promise) {
    cached.mongoose.promise = mongoose.connect(MONGODB_URI);
  }
  cached.mongoose.conn = await cached.mongoose.promise;
  return cached.mongoose.conn;
}
