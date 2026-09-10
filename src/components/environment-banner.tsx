
import { UiText } from "@/components/ui-text";
const environment =
  process.env.NEXT_PUBLIC_APP_ENVIRONMENT ?? process.env.APP_ENVIRONMENT ?? "development";

export function EnvironmentBanner() {
  if (environment !== "staging") {
    return null;
  }

  return (
    <div
      className="staging-grid border-b border-amber-200/20 bg-amber-300/10 px-4 py-3 text-center text-sm text-amber-50"
      data-testid="staging-banner"
    ><UiText text={"Staging environment. Validate new features here before promoting to production."} /></div>
  );
}