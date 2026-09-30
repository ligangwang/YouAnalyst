import { adminMusicResponse } from '@/lib/music/http';
import { NextRequest } from 'next/server';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) { return adminMusicResponse(request); }
export async function POST(request: NextRequest) { return adminMusicResponse(request); }
export async function PATCH(request: NextRequest) { return adminMusicResponse(request); }
export async function DELETE(request: NextRequest) { return adminMusicResponse(request); }
