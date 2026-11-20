// Announcement cards and publisher validation need no captured article body,
// model analysis, or ingestion metadata. Keep the pagination field included.
export const ANNOUNCEMENT_EVENT_FIELDS = ['version','companyId','id','title','url','published_at','publication_date',
  'type','sourceType','sourceId','category','form'] as const;

export const announcementCachePath = (company: string) => `collectors/_announcement_windows_v1/companies/${company}`;
export const announcementSearchLimit = 30;
