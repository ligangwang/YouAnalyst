import Image from "next/image";

const supportedCountries = new Set(["CA", "CN", "FR", "GB", "IE", "NL", "SG", "TW", "US"]);

export function CompanyCountryFlag({ country, locale }: { country?: string | null; locale: string }) {
  if (!country || !supportedCountries.has(country)) return null;
  const label = new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country;
  return <Image src={`/flags/${country.toLowerCase()}.svg`} width={24} height={18} unoptimized loading="eager" alt={label} title={label} className="mr-2 inline-block h-[18px] w-6 rounded-[1px] align-baseline" />;
}
