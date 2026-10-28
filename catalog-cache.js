// Only public market catalogues belong here; account data and tokens never do.
(function(root){
 'use strict';
 const CACHE='viewinvai-public-catalog-v1',NAMES=new Set(['market','funds']);
 async function saveOffline(name,response){
  if(!NAMES.has(name)||!response?.ok||!root.caches||!String(response.headers.get('Content-Type')||'').includes('json'))return false;
  try{const cache=await root.caches.open(CACHE);await cache.put('/offline/'+name,response);return true}catch(_){return false}
 }
 async function loadOffline(name){
  if(!NAMES.has(name)||!root.caches)return null;
  try{return(await(await root.caches.open(CACHE)).match('/offline/'+name))||null}catch(_){return null}
 }
 root.ViewInvAICatalogCache=Object.freeze({saveOffline,loadOffline});
})(window);
