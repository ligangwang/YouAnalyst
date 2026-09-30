import { publicMusicResponse } from '@/lib/music/http';
export const runtime = 'nodejs';
export async function GET() { return publicMusicResponse(); }
