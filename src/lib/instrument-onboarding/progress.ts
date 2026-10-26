export const COMPANY_STEPS=['themes','profile','events'] as const;
export const ONBOARDING_STEPS=['identity',...COMPANY_STEPS,'corporateActions','prices','verify'] as const;
export const LEGACY_THEME_BLOCK='themes: Reviewed theme assignment is required';
export const LEGACY_NO_THEME_MATCH='themes: At least one existing theme is required';
export const NO_THEME_MATCH_REASON='No appropriate existing theme matches the official company evidence';
export const ONBOARDING_FILTERS=['ALL','QUEUED','PROCESSING','BLOCKED','SUPPORTED','ERRORS'] as const;
export type OnboardingFilter=typeof ONBOARDING_FILTERS[number];
export function canResumeAutomaticThemes(request:{status:string;lastError:string|null;steps:Partial<Record<typeof ONBOARDING_STEPS[number],'COMPLETE'>>}){
  return request.status==='BLOCKED'&&request.lastError===LEGACY_THEME_BLOCK&&request.steps.identity==='COMPLETE'&&!request.steps.themes;
}
