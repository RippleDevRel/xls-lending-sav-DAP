import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Service disclaimer, data collection, and privacy policy for the XLS-66 lending reference app.",
};

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="container mx-auto px-6 pt-6 max-w-3xl flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex-grow container mx-auto px-6 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight mb-10">
          Terms of Service
        </h1>

        <div className="space-y-8 text-sm text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">
              Service Disclaimer
            </h2>
            <p className="mb-3">
              The webapp available at TBD (the &quot;Service&quot;) is provided
              exclusively for testing and development purposes on supported
              testnets.
            </p>
            <p className="mb-3">
              All tokens distributed through this Service are testnet/devnet
              tokens only and hold no monetary or real-world value. These tokens
              must not be used for any financial transactions, investments, or
              commercial activities.
            </p>
            <p className="mb-3">
              You are solely responsible for the security and management of your
              wallet, including any private keys or seed phrases associated with
              it. Do not reuse the generated wallets outside this app.
            </p>
            <p>
              This Service is provided &quot;as is&quot; without warranties of
              any kind, express or implied.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">
              Data Collection
            </h2>
            <p className="mb-3">
              When authenticating via Email, the following information is
              collected:
            </p>
            <ul className="list-disc pl-5 space-y-1 mb-3">
              <li>Email</li>
              <li>Wallet addresses generated for testing</li>
            </ul>
            <p>
              This information may be shared and used for marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-3">
              Privacy
            </h2>
            <p>
              By using this website, you agree that the personal information you
              provide will be used to facilitate your use of the services within
              this website. For more details, see our{" "}
              <a
                href="https://ripple.com/legal/privacy-policy/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              >
                Privacy Policy
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
