"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import { SessionHeader } from "@/components/session-header";
import { RoleTabs } from "@/components/role-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Footer } from "@/components/footer";
import { DotPattern } from "@/components/ui/dot-pattern";
import { motion } from "motion/react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, initializing } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!initializing && !session) {
      router.push("/");
    }
  }, [initializing, session, router]);

  if (initializing) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-6 py-8 max-w-5xl space-y-6">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <DotPattern className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] [mask-image:radial-gradient(900px_circle_at_top,white,transparent)]" />

      <div className="relative z-10 flex-grow flex flex-col">
        {/* Sticky header */}
        <div className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-sm">
          <div className="container mx-auto px-6 py-3 max-w-5xl">
            <SessionHeader />
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b bg-background">
          <div className="container mx-auto px-6 py-3 max-w-5xl">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <RoleTabs />
            </motion.div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-grow container mx-auto px-6 py-8 max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            {children}
          </motion.div>
        </div>

        <Footer />
      </div>
    </div>
  );
}
