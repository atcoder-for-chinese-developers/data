import { Site, Parameters } from "./types.ts";
import atcoder from "./atcoder/atcoder.ts";
import { newConnection } from "./storage/query.ts";
import { getArticle, getArticles, updateArticles } from "./storage/storage.ts";

const sites = {
  'atcoder': atcoder
} as {[id: string]: Site}

export async function exec(site: string, method: string, params: Parameters): Promise<any> {
  if (method === 'updateArticles') {
    const conn = newConnection();
    await updateArticles(conn);
    conn.end();
    return 'OK';
  }
  if (!sites[site]) throw new Error(`Site ${site} not found`);
  if (method === 'getArticle') {
    const conn = newConnection();
    const data = await getArticle(conn, site, params);
    conn.end();
    return data;
  }
  if (method === 'getArticles') {
    const conn = newConnection();
    const data = await getArticles(conn, site, params);
    conn.end();
    return data;
  }
  if (!sites[site][method]) throw new Error(`Unsupported method ${method} of site ${site}`);
  const conn = newConnection();
  const storage = await sites[site].checkStorage(conn);
  if (method === 'checkStorage') {
    conn.end();
    return;
  }
  const data = await sites[site][method](conn, storage, params);
  conn.end();
  return data;
}