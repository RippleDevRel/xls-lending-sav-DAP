import type { MetadataRoute } from "next";

/**
 * PWA manifest. Next.js serves this at `/manifest.webmanifest` and wires
 * it through the `manifest` field of the root metadata export.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "XLS-66 Lending Protocol · XRPL Reference App",
    short_name: "XLS-66 Lending",
    description:
      "Open-source reference implementation of the XRP Ledger lending amendments (XLS-66 + XLS-65) on Devnet.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
    categories: ["finance", "developer"],
  };
}
