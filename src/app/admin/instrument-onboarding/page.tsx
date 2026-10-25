import type {Metadata} from 'next';
import {localizedMetadata} from '@/lib/ui/i18n/server';
import {noIndexRobots} from '@/lib/seo';
import {AdminInstrumentOnboardingPage} from '@/components/admin-instrument-onboarding-page';
export async function generateMetadata():Promise<Metadata>{return localizedMetadata({title:'Instrument Onboarding | Admin | YouAnalyst',robots:noIndexRobots()});}
export default function Page(){return <AdminInstrumentOnboardingPage/>;}
