import { next } from '@vercel/functions';
import { gate } from './auth.mjs';
export default async function proxy(request) {
 const denied=await gate(request);
 if(denied)return denied;
 return next({headers:{'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex, nofollow, noarchive'}});
}
