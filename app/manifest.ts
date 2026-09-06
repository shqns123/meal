import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "우리집 식탁",
    short_name: "우리집 식탁",
    description: "가족을 위한 식단 플래너",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f4",
    theme_color: "#f6f5f4",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
