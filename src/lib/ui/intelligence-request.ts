/** Retry only Google's HTML routing miss, not application 404s or other errors.
 * The failed document preload must yield to a fresh no-store read. */
export async function intelligenceRequest(url:string,options:RequestInit,request:typeof fetch=fetch){
  const response=await request(url,options);
  if((options.method??'GET').toUpperCase()!=='GET')return response;
  if(response.status!==404||!response.headers.get('content-type')?.includes('text/html'))return response;
  const body=await response.clone().text();
  if(!body.includes('The requested URL was not found on this server'))return response;
  return request(url,{...options,cache:'no-store'});
}
