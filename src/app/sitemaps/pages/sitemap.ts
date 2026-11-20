import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo';
import { localizedPath } from '@/lib/ui/i18n/urls';
export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/about', '/how-it-works'].flatMap(path => {
    const languages = {en:absoluteUrl(localizedPath(path,'en')), 'zh-CN':absoluteUrl(localizedPath(path,'zh-CN'))};
    return Object.values(languages).map(url => ({url, alternates:{languages}, changeFrequency:'monthly' as const}));
  });
}
