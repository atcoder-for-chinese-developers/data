import { Connection, RowDataPacket } from "mysql2/index";
import { exec, prepare, preparedExec, query, unprepare } from "./query.ts";
import fs, { stat } from "fs";
import { Article, CommitInfo, Parameters, StoredArticle, StoredArticleTags } from "../types.ts";

export class TableController {
  fullname: string;
  conn: Connection;

  constructor(conn: Connection, name: string) {
    this.fullname = name;
    this.conn = conn;
  }
  public async insert(cols: string[], rows: any[][], blockSize: number = 300) {
    const fields = (cols.map(col => `\`${col}\``)).join(',');
    const placeholders = (cols.map(() => '?')).join(',');
    const total = rows.length;
    if (!total) return;
    const d = total % blockSize;
    if (d) {
      const placeholderlist = [] as string[];
      for (let i = 0; i < d; i++) placeholderlist.push(`(${placeholders})`);
      const sql = `INSERT INTO \`${this.fullname}\` (${fields}) VALUES ${placeholderlist.join(',')}`;
      const statement = await prepare(this.conn, sql);
      await preparedExec(statement, ([] as any[]).concat(...rows.slice(0, d)));
      unprepare(this.conn, sql);
    }
    const t = (total - d) / blockSize;
    if (!t) return;
    const placeholderlist = [] as string[];
    for (let i = 0; i < blockSize; i++) placeholderlist.push(`(${placeholders})`);
    const sql = `INSERT INTO \`${this.fullname}\` (${fields}) VALUES ${placeholderlist.join(',')}`;
    const statement = await prepare(this.conn, sql);
    for (let i = 0; i < t; i++) {
      await preparedExec(statement, ([] as any[]).concat(...rows.slice(d + i * blockSize, d + (i + 1) * blockSize)));
    }
    unprepare(this.conn, sql);
  }
  public async delete(where?: string) {
    await query(this.conn, `DELETE FROM \`${this.fullname}\`${where ? ` WHERE ${where}` : ''}`);
  }
  public async get<T>(which?: string, where?: string): Promise<T[]> {
    return (await query(this.conn, `SELECT ${which || '*'} FROM \`${this.fullname}\`${where ? ` WHERE ${where}` : ''}`)) as T[];
  }
  public async update(which: string, value: string, where?: string) {
    await query(this.conn, `UPDATE \`${this.fullname}\` SET \`${which}\`=${value}${where ? ` WHERE ${where}` : ''}`);
  }
  public async select<T>(what: string, how: string, values: any): Promise<T> {
    const sql = `SELECT ${what} FROM \`${this.fullname}\` ${how}`;
    const statement = await prepare(this.conn, sql);
    const data = (await preparedExec(statement, values)) as T;
    await unprepare(this.conn, sql);
    return data;
  }
}
export class SiteStorageController {
  site: string;
  conn: Connection;

  constructor(conn: Connection, site: string) {
    this.site = site;
    this.conn = conn;
  }
  public async getTableSet() {
    return new Set((await (new TableController(this.conn, `${this.site}._tables`).get<{name: string}>('name'))).map(e => e.name));
  }
  public async checkTable(name: string, cols: {name: string, attr: string}[], extra?: string[]) {
    const tableSet = await this.getTableSet();
    if (tableSet.has(name)) return;
    await newTable(this.conn, `${this.site}.${name}`, cols, extra);
    await (new TableController(this.conn, `${this.site}._tables`)).insert(['name'], [[name]]);
  }
  public async newTableController(name: string) {
    return new TableController(this.conn, `${this.site}.${name}`);
  }
  public async getAttribute(key: string): Promise<string | null> {
    const value = (await (new TableController(this.conn, this.site)).get<{value: string}>('value', `\`key\`="${key}"`));
    if (!value.length) return null;
    else return value[0].value;
  }
  public async setAttribute(key: string, value: string) {
    const meta = new TableController(this.conn, this.site);
    if (await this.getAttribute(key) === null) await meta.insert(['key', 'value'], [[key, value]]);
    else await meta.update('value',`"${value}"` , `\`key\`="${key}"`);
  }
  public async removeAttribute(key: string, value: string) {
    const meta = new TableController(this.conn, this.site);
    if (await this.getAttribute(key) !== null) await meta.delete(`\`key\`="${key}"`);
  }
  public async checkUpdate(interval: number, action: (tableController: SiteStorageController) => Promise<void>) {
    const pending = (await this.getAttribute('pending')) || '2';
    if (pending === '1') return;
    const updated = new Date(await this.getAttribute('updated') || 0);
    if (pending === '2' || (new Date()).getTime() - updated.getTime() >= interval) {
      try {
        await this.setAttribute('pending', '1');
        await action(this);
        await this.setAttribute('pending', '0');
      } catch (e) {
        await this.setAttribute('pending', '2');
        throw e;
      }
      await this.setAttribute('updated', (new Date()).toUTCString());
    }
  }
}

async function getTableSet(conn: Connection): Promise<Set<string>> {
  return new Set(((await query(conn, 'SHOW TABLES')) as RowDataPacket[]).map(e => {
    for (const id in e) return e[id];
  }));
}
async function newTable(conn: Connection, name: string, cols: {name: string, attr: string}[], extra?: string[]) {
  const rowStr = (cols.map(col => `\`${col.name}\` ${col.attr}`).concat(extra || [])).join(',');
  await query(conn, `CREATE TABLE IF NOT EXISTS \`${name}\` (${rowStr}) ENGINE=InnoDB DEFAULT CHARSET=utf8`);
}
async function initSite(conn: Connection, site: string, ver: string) {
  await newTable(conn, site, [
    {name: 'key', attr: 'VARCHAR(32) NOT NULL'},
    {name: 'value', attr: 'VARCHAR(128) NOT NULL'}
  ]);
  await newTable(conn, `${site}._tables`, [
    {name: 'name', attr: 'VARCHAR(32) NOT NULL'}
  ]);
  const storage = new SiteStorageController(conn, site);
  await storage.setAttribute("ver", ver);
  await storage.setAttribute("updated", (new Date()).toUTCString());
  await storage.setAttribute("pending", '2');
}
async function dropTable(conn: Connection, name: string) {
  await query(conn, `DROP TABLE \`${name}\``);
}
async function clearSite(conn: Connection, site: string) {
  const tableSet = await (new SiteStorageController(conn, site)).getTableSet();
  for (const table of tableSet.values()) await dropTable(conn, `${site}.${table}`);
  await dropTable(conn, `${site}._tables`);
  await dropTable(conn, `${site}`);
}

export async function newStorageController(conn: Connection, site: string, ver: string) {
  if (!/^[a-zA-Z0-9]+/.test(site)) throw new Error('Invalid parameter <site>');
  if (!/^[a-zA-Z0-9.]+/.test(ver)) throw new Error('Invalid parameter <ver>');
  const tableSet = await getTableSet(conn);
  if (!tableSet.has(site)) await initSite(conn, site, ver);
  const siteStorageController = new SiteStorageController(conn, site);
  if ((await siteStorageController.getAttribute('ver')) !== ver) await clearSite(conn, site), await initSite(conn, site, ver);
  await newTable(conn, `${site}._articles`, [
    {name: 'id', attr: 'VARCHAR(128) NOT NULL'},
    {name: 't', attr: 'INT NOT NULL'},
    {name: 's', attr: 'INT NOT NULL'}
  ]);
  return new SiteStorageController(conn, site);
}

function readJSON(path: string) {
  const json = fs.readFileSync(path).toString();
  return JSON.parse(json);
}
export async function updateArticles(conn: Connection) {
  await newTable(conn, `_articles`, [
    {name: 'site', attr: 'VARCHAR(128) NOT NULL'},
    {name: 'pid', attr: 'VARCHAR(128) NOT NULL'},
    {name: 'type', attr: 'VARCHAR(2) NOT NULL'},
    {name: 'id', attr: 'VARCHAR(128) NOT NULL'},
    {name: 'title', attr: 'VARCHAR(1024) NOT NULL'},
    {name: 'author', attr: 'VARCHAR(128) NOT NULL'},
    {name: 'created', attr: 'TIMESTAMP NOT NULL'},
    {name: 'updated_time', attr: 'TIMESTAMP NOT NULL'},
    {name: 'updated_commit', attr: 'VARCHAR(256) NOT NULL'},
    {name: 'updated_commit_short', attr: 'VARCHAR(16) NOT NULL'},
    {name: 'rendered', attr: 'LONGTEXT NOT NULL'}
  ]);
  await newTable(conn, `_article_tags`, [
    {name: 'site', attr: 'VARCHAR(128) NOT NULL'},
    {name: 'pid', attr: 'VARCHAR(128) NOT NULL'},
    {name: 'type', attr: 'VARCHAR(2) NOT NULL'},
    {name: 'id', attr: 'VARCHAR(128) NOT NULL'},
    {name: 'tag', attr: 'VARCHAR(128) NOT NULL'}
  ]);
  const siteList = readJSON(`${process.env.ARTICLES_PATH}/list.json`) as {[id: string]: CommitInfo};
  const insertArticleList = [] as [string, string, string, string, string, string, Date, Date, string, string, string][];
  const insertArticleTagList = [] as [string, string, string, string, string][];
  for (const site in siteList) {
    await newTable(conn, `${site}._articles`, [
      {name: 'id', attr: 'VARCHAR(128) NOT NULL'},
      {name: 't', attr: 'INT NOT NULL'},
      {name: 's', attr: 'INT NOT NULL'}
    ]);
    const problemList = readJSON(`${process.env.ARTICLES_PATH}/${site}/list.json`) as {[id: string]: [number, number]};
    const articlesTableController = new TableController(conn, `${site}._articles`);
    const statsList = [] as [string, number, number][];
    for (const problem in problemList) statsList.push([problem, ...problemList[problem]]);
    await articlesTableController.delete();
    await articlesTableController.insert(['id', 't', 's'], statsList);
    for (const problem in problemList) {
      const articleList = readJSON(`${process.env.ARTICLES_PATH}/${site}/${problem}/list.json`) as {[type: string]: Article[]};
      for (const type in articleList) {
        for (const article of articleList[type]) {
          const rendered = readJSON(`${process.env.ARTICLES_PATH}/${site}/${problem}/${type}/${article.id}/data.json`).rendered as string;
          article.site = site, article.type = type.charAt(0), article.pid = problem;
          insertArticleList.push([
            article.site,
            article.pid,
            article.type,
            article.id,
            article.title,
            article.author || '未知',
            new Date(article.created || 1000),
            new Date(article.lastCommit.date),
            article.lastCommit.id,
            article.lastCommit.short,
            rendered
          ]);
          for (const tag of article.tags || []) {
            insertArticleTagList.push([
              article.site,
              article.pid,
              article.type,
              article.id,
              tag
            ]);
          }
        }
      }
    }
  }
  const articlesTableController = new TableController(conn, '_articles');
  const articleTagsTableController = new TableController(conn, '_article_tags');
  await articlesTableController.delete();
  await articleTagsTableController.delete();
  await articlesTableController.insert(
    [
      'site',
      'pid',
      'type',
      'id',
      'title',
      'author',
      'created',
      'updated_time',
      'updated_commit',
      'updated_commit_short',
      'rendered'
    ], insertArticleList);
  await articleTagsTableController.insert(
    [
      'site',
      'pid',
      'type',
      'id',
      'tag'
    ], insertArticleTagList);
}
export async function getArticle(conn: Connection, site: string, params: Parameters): Promise<Article> {
  const {pid, type, aid} = params;
  if (!pid || !type || !aid) throw new Error('Invalid parameters');
  const list = await exec(
    conn,
    `SELECT title,author,created,updated_time,updated_commit,updated_commit_short,rendered FROM \`_articles\` WHERE site = ? AND pid = ? AND type = ? AND id = ?`,
    [site, pid, type, aid]
  ) as StoredArticle[];
  const tags = await exec(
    conn,
    `SELECT tag FROM \`_article_tags\` WHERE site = ? AND pid = ? AND type = ? AND id = ?`,
    [site, pid, type, aid]
  ) as StoredArticleTags[];
  if (!list.length) throw new Error('No such article found');
  let article = list[0];
  return {
    site: site,
    pid: pid,
    id: aid,
    type: type,
    rendered: article.rendered,
    lastCommit: {
      id: article.updated_commit,
      short: article.updated_commit_short,
      date: article.updated_time.toUTCString()
    },
    author: article.author,
    title: article.title,
    tags: tags.map(tag => tag.tag)
  };
}

export async function getArticles(conn: Connection, site: string, params: Parameters): Promise<Article[]> {
  const {pid, type} = params;
  if (!pid || !type) throw new Error('Invalid parameters');
  const list = await exec(
    conn,
    `SELECT title,author,created,updated_time,updated_commit,updated_commit_short FROM \`_articles\` WHERE site = ? AND pid = ? AND type = ?`,
    [site, pid, type]
  ) as StoredArticle[];
  const tags = await exec(
    conn,
    `SELECT id,tag FROM \`_article_tags\` WHERE site = ? AND pid = ? AND type = ?`,
    [site, pid, type]
  ) as StoredArticleTags[];
  const tagDic = {} as {[path: string]: string[]};
  tags.forEach(tag => {
    if (!tagDic[tag.id]) tagDic[tag.id] = [];
    tagDic[tag.id].push(tag.tag);
  });
  return list.map(article => { return {
    site: site,
    pid: pid,
    id: article.id,
    type: type,
    lastCommit: {
      id: article.updated_commit,
      short: article.updated_commit_short,
      date: article.updated_time.toUTCString()
    },
    author: article.author,
    title: article.title,
    tags: tagDic[article.id] || []
  }; });
}
