export const COMPANY_STEPS=['themes','profile','events'] as const;
export const ONBOARDING_STEPS=['identity',...COMPANY_STEPS,'corporateActions','prices','verify'] as const;
export const LEGACY_THEME_BLOCK='themes: Reviewed theme assignment is required';
export function canResumeAutomaticThemes(request:{status:string;lastError:string|null;steps:Partial<Record<typeof ONBOARDING_STEPS[number],'COMPLETE'>>}){
  return request.status==='BLOCKED'&&request.lastError===LEGACY_THEME_BLOCK&&request.steps.identity==='COMPLETE'&&!request.steps.themes;
}
