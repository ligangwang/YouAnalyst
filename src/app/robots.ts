import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

const restrictedPaths = ["/admin", "/api", "/auth", "/en/admin", "/zh-cn/admin", "/en/auth", "/zh-cn/auth"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: restrictedPaths,
      },
      {
        userAgent: "GoogleOther",
        disallow: [...restrictedPaths, "/predictions/new", "/en/predictions/new", "/zh-cn/predictions/new"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
