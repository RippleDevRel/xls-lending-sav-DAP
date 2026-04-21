"use client";

import { Separator } from "@/components/ui/separator";

const links: { label: string; href: string; isTwitter?: boolean }[] = [
  { label: "XRPL", href: "https://xrpl.org/" },
  {
    label: "XLS-66 Docs",
    href: "https://xrpl.org/docs/concepts/tokens/lending-protocol",
  },
  {
    label: "XLS-65 Docs",
    href: "https://xrpl.org/docs/concepts/tokens/single-asset-vaults",
  },
  {
    label: "XLS-66 Spec",
    href: "https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0066-lending-protocol",
  },
  {
    label: "XLS-65 Spec",
    href: "https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0065-single-asset-vault",
  },
];

export function Footer() {
  return (
    <footer className="py-8 mt-auto">
      <Separator className="mb-8" />
      <div className="container mx-auto px-6 max-w-5xl">
        <div className="flex flex-col items-center gap-4">
          <nav className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2">
            {links.map((link, index) => (
              <a
                key={index}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5"
              >
                {link.isTwitter && (
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="h-4 w-4 fill-current"
                  >
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                )}
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
            <a href="/terms" className="hover:text-primary transition-colors">Terms of Service</a>
          </div>

          <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground/60">
            <a
              href="https://x.com/krkmu_"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-primary transition-colors"
              aria-label="Follow krkmu on X"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-3 w-3 fill-current"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>@krkmu_</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
