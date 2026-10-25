import {NextRequest} from 'next/server';
import {userRoleResponse} from '@/lib/admin-user-roles/http';
export const GET=(request:NextRequest)=>userRoleResponse(request);
export const PATCH=(request:NextRequest)=>userRoleResponse(request);
