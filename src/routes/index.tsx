import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/panel" });
  },
  head: () => ({
    meta: [
      { title: "SIMAP-Web" },
      { name: "description", content: "Monitoreo y actualización de portales WordPress institucionales." },
      { property: "og:title", content: "SIMAP-Web" },
      { property: "og:description", content: "Monitoreo y actualización de portales WordPress institucionales." },
    ],
  }),
});
