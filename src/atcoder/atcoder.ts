import fetch from "node-fetch";
import { NativeContest, NativeContestProblem, NativeDifficultySet, NativeProblem, StoredContest, StoredContestProblem, StoredProblem } from "./types.ts";
import { Connection } from "mysql2/index";
import { newStorageController, SiteStorageController } from "../storage/storage.ts";
import { exec } from "../storage/query.ts";
import { Difficulty, Problem, Contest, ContestProblem, Site, Parameters } from "../types.ts";

const ver = "v1.0.12";

async function getObject(url: string) {
    const response = await fetch(url);
    return await response.json();
}

async function resolveProblems(): Promise<StoredProblem[]> {
    let problems = [] as StoredProblem[];
    const data = await getObject("https://kenkoooo.com/atcoder/resources/problems.json") as NativeProblem[];
    for (const i in data) {
        const problem = data[i];
        problems.push({
            id: problem.id,
            title: problem.name,
            link: null,
            difficulty: null,
            date: new Date(1000),
            search: `${problem.id} ${problem.name}`
        });
    }
    return problems.reverse();
}

async function resolveDifficulties(problems: StoredProblem[]): Promise<StoredProblem[]> {
    const data = await getObject("https://kenkoooo.com/atcoder/resources/problem-models.json") as NativeDifficultySet;
    for (const i in problems) {
        const problem = data[problems[i].id];
        if (problem && problem.difficulty) problems[i].difficulty = problem.difficulty;
    }
    return problems;
}

async function resolveContests(): Promise<StoredContest[]> {
    const contests = [] as StoredContest[];
    const nativeContests = await getObject("https://kenkoooo.com/atcoder/resources/contests.json") as NativeContest[];
    for (const i in nativeContests) {
        const contest = nativeContests[i], id = contest.id;
        const current = {
            id: id, title: contest.title,
            problems: [],
            link: "https://atcoder.jp/contests/" + contest.id,
            category: 'others',
            date: new Date(Math.max(contest.start_epoch_second * 1000, 1000)),
            search: `${contest.id} ${contest.title}`
        } as StoredContest;
        let prefix = id.slice(0, 3);
        if (prefix === "abc" || prefix === "arc" || prefix === "agc" || prefix === "ahc") current.category = prefix;
    	else {
            try {
                let ratedRange = contest.rate_change, rightRangeStr = ratedRange.split("~")[1];
                if (rightRangeStr == " " || ratedRange == "All") rightRangeStr = "9999";
                if (rightRangeStr) {
                    let rightRange = parseInt(rightRangeStr);
                    if (rightRange < 2000) current.category = 'abc_like';
                    else if (rightRange < 2800) current.category = 'arc_like';
                    else current.category = 'agc_like';
                }
	        } catch {
                 console.log("Failed to filter " + id + " failed.");
	        }
	    }
        contests.push(current);
    }
    return contests;
}

async function resolveContestProblem(problems: StoredProblem[], contests: StoredContest[]): Promise<[StoredProblem[], StoredContest[]]> {
    const contestProblem = await getObject("https://kenkoooo.com/atcoder/resources/contest-problem.json") as NativeContestProblem[];
    const contestProblemSet = {} as {[id: string]: StoredContestProblem[]};
    const contestDateSet = {} as {[id: string]: Date};
    const contestTitleSet = {} as {[id: string]: string};
    const problemSet = new Set<string>();
    const linkSet = {} as {[id: string]: string};
    const dateSet = {} as {[id: string]: Date};
    const searchSet = {} as {[id: string]: string};
    for (const problem of problems) problemSet.add(problem.id);
    for (const contest of contests) contestDateSet[contest.id] = contest.date, contestTitleSet[contest.id] = contest.title;
    for (const i in contestProblem) {
        const cur = contestProblem[i];
        if (!problemSet.has(cur.problem_id)) {
            console.log("Problem '" + cur.problem_id + "' belongs to contest '" + cur.contest_id + "' not found.");
            continue;
        }
        if (!contestProblemSet[cur.contest_id]) contestProblemSet[cur.contest_id] = [];
        contestProblemSet[cur.contest_id].push({pid: cur.problem_id, index: cur.problem_index});
        linkSet[cur.problem_id] = `https://atcoder.jp/contests/${cur.contest_id}/tasks/${cur.problem_id}`;
        if (!dateSet[cur.problem_id] || dateSet[cur.problem_id] > contestDateSet[cur.contest_id]) {
            dateSet[cur.problem_id] = contestDateSet[cur.contest_id];
        }
        searchSet[cur.problem_id] = (searchSet[cur.problem_id] || '') + `${cur.contest_id} ${contestTitleSet[cur.contest_id]} `;
    }
    for (const i in contests) {
        const contest = contests[i];
        if (contestProblemSet[contest.id]) contests[i].problems = contestProblemSet[contest.id] || [];
    }
    for (const i in problems) {
        problems[i].link = linkSet[problems[i].id] || null;
        problems[i].date = dateSet[problems[i].id] || problems[i].date;
        problems[i].search = (searchSet[problems[i].id] || '') + problems[i].search;
    }
    return [problems, contests];
}

async function checkStorage(conn: Connection): Promise<SiteStorageController> {
    const storage = await newStorageController(conn, 'atcoder', ver);
    await storage.checkTable('problemset', [
        {name: 'id', attr: 'VARCHAR(256) PRIMARY KEY NOT NULL'},
        {name: 'title', attr: 'VARCHAR(256) NOT NULL'},
        {name: 'search', attr: 'VARCHAR(2048) NOT NULL'},
        {name: 'link', attr: 'VARCHAR(256)'},
        {name: 'difficulty', attr: 'SMALLINT'},
        {name: 'date', attr: 'TIMESTAMP NOT NULL'}
    ], ['FULLTEXT KEY search_fulltext(search)']);
    await storage.checkTable('contestset', [
        {name: 'id', attr: 'VARCHAR(256) PRIMARY KEY NOT NULL'},
        {name: 'title', attr: 'VARCHAR(256) NOT NULL'},
        {name: 'search', attr: 'VARCHAR(2048) NOT NULL'},
        {name: 'link', attr: 'VARCHAR(256)'},
        {name: 'category', attr: 'VARCHAR(16) NOT NULL'},
        {name: 'date', attr: 'TIMESTAMP NOT NULL'}
    ], ['FULLTEXT KEY search_fulltext(search)']);
    await storage.checkTable('contestproblem', [
        {name: 'cid', attr: 'VARCHAR(256) NOT NULL'},
        {name: 'pid', attr: 'VARCHAR(256) NOT NULL'},
        {name: 'index', attr: 'VARCHAR(16) NOT NULL'},
    ]);
    await storage.checkUpdate(86400000, async (storage) => {
        const [problems, contests] = await resolveContestProblem(await resolveDifficulties(await resolveProblems()), await resolveContests());
        const problemset = await storage.newTableController('problemset');
        const contestset = await storage.newTableController('contestset');
        const contestproblem = await storage.newTableController('contestproblem');
        await problemset.delete(), await contestset.delete(), await contestproblem.delete();
        await problemset.insert(
            ['id', 'title', 'link', 'difficulty', 'date', 'search'],
            problems.map(problem =>
                [problem.id, problem.title, problem.link, problem.difficulty, problem.date, problem.search]
            )
        );
        await contestset.insert(
            ['id', 'title', 'link', 'category', 'date', 'search'],
            contests.map(contest =>
                [contest.id, contest.title, contest.link, contest.category, contest.date, contest.search]
            )
        );
        const contestproblems = [] as {pid: string, cid: string, index: string}[];
        contests.forEach(contest => {
            contest.problems.forEach(problem => contestproblems.push({pid: problem.pid, cid: contest.id, index: problem.index}));
        });
        await contestproblem.insert(
            ['pid', 'cid', 'index'],
            contestproblems.map(e => [e.pid, e.cid, e.index])
        );
    });
    return storage;
}


function resolveDifficulty(difficulty: number): Difficulty {
    function getTextColor(difficulty: number): string {
        if (difficulty < 400) return 'rgb(128, 128, 128)';
        if (difficulty < 800) return 'rgb(128, 64, 0)';
        if (difficulty < 1200) return 'rgb(0, 128, 0)';
        if (difficulty < 1600) return 'rgb(0, 192, 192)';
        if (difficulty < 2000) return 'rgb(0, 0, 255)';
        if (difficulty < 2400) return 'rgb(192, 192, 0)';
        if (difficulty < 2800) return 'rgb(255, 128, 0)';
        return 'rgb(255, 0, 0)';
    }
    function getDifficultyColor(difficulty: number): string {
        if (difficulty < 400) return 'rgb(128, 128, 128)';
        if (difficulty < 800) return 'rgb(128, 64, 0)';
        if (difficulty < 1200) return 'rgb(0, 128, 0)';
        if (difficulty < 1600) return 'rgb(0, 192, 192)';
        if (difficulty < 2000) return 'rgb(0, 0, 255)';
        if (difficulty < 2400) return 'rgb(192, 192, 0)';
        if (difficulty < 2800) return 'rgb(255, 128, 0)';
        if (difficulty < 3200) return 'rgb(255, 0, 0)';
        if (difficulty < 3600) return 'rgb(150, 92, 44)';
        if (difficulty < 4000) return 'rgb(128, 128, 128)';
        return 'rgb(255, 215, 0)';
    }
    function getDifficultyRate(difficulty: number): number {
        let displayDifficulty = difficulty;
        if (displayDifficulty < 400) displayDifficulty = Math.round(400 / Math.exp(1 - displayDifficulty / 400));
        if (displayDifficulty >= 3200) return 1;
        return (displayDifficulty % 400) / 400;
    }
    return {
        type: difficulty >= 3200 ? 'medal' : 'normal',
        color: getDifficultyColor(difficulty),
        textColor: getTextColor(difficulty),
        rate: getDifficultyRate(difficulty),
        value: difficulty
    };
}

async function getArticleStats(conn: Connection, idSet: string, idSetValues?: any): Promise<{[id: string]: [number, number]}> {
    const stats = await exec(conn, `SELECT * FROM \`atcoder._articles\` WHERE id IN(SELECT id FROM (${idSet}) AS tPID)`, idSetValues) as {id: string, t: number, s: number}[];
    let ret = {} as {[id: string]: [number, number]};
    for (const stat of stats) ret[stat.id] = [stat.t, stat.s];
    return ret;
}
async function getProblems(
    conn: Connection,
    storage: SiteStorageController,
    params: Parameters
) : Promise<Problem[]> {
    let {search, order, maxDifficulty, minDifficulty, start, end} = params;
    let orderArr = ['date desc', `REGEXP_REPLACE(id, '[0-9]', '')`, `REGEXP_REPLACE(id, '[^0-9]', '') + 0`].reverse() as string[];
    let orderValues = [];
    if (search) orderArr.push('MATCH(search) AGAINST(?) desc'), orderValues.push(search);
    if (order) orderArr.push(order);
    const ordersql = `ORDER BY ${orderArr.reverse().join(',')}`
    const limitsql = `LIMIT ${start || 0},${end ? (end - (start || 0)) : 2147483647}`;
    if (maxDifficulty !== undefined || minDifficulty !== undefined) {
        if (maxDifficulty === undefined) maxDifficulty = 100000;
        if (minDifficulty === undefined) minDifficulty = -100000;
    }
    const wheresql = `${search || maxDifficulty != undefined ? `WHERE ` : ``}${search ? 'MATCH(search) AGAINST(?) ' : ''}${(search && maxDifficulty !== undefined) ? 'and ' : ''}${maxDifficulty !== undefined ? `difficulty >= ? and difficulty <= ? ` : ''}`;
    const conditionValues = [...(search ? [search] : []), ...(maxDifficulty !== undefined ? [minDifficulty, maxDifficulty] : [])];
    const sql = `${wheresql}${ordersql} ${limitsql}`;
    const problemset = await storage.newTableController('problemset');
    const values =  [...conditionValues, ...orderValues];
    const stored = await problemset.select<StoredProblem[]>('id,title,link,difficulty', sql, values);
    const stats = await getArticleStats(conn, `SELECT id FROM \`atcoder.problemset\` ${wheresql} ${ordersql} ${limitsql}`, [...conditionValues, ...orderValues]);
    return stored.map(problem => {
        return {
            id: problem.id,
            title: problem.title,
            link: problem.link,
            difficulty: problem.difficulty ? resolveDifficulty(problem.difficulty) : null,
            articles: stats[problem.id] || [0, 0]
        };
    }) as Problem[];
}

async function getContests(
    conn: Connection,
    sotrage: SiteStorageController,
    params: Parameters
): Promise<Contest[]> {
    let {start, end, category, search} = params;
    let orderArr = ['date desc', `REGEXP_REPLACE(id, '[0-9]', '')`, `REGEXP_REPLACE(id, '[^0-9]', '') + 0`].reverse() as string[];
    let orderValues = [];
    if (search) orderArr.push('MATCH(search) AGAINST(?) desc'), orderValues.push(search);
    const ordersql = `ORDER BY ${orderArr.reverse().join(',')}`;
    orderValues = orderValues.reverse();
    const limitsql = `LIMIT ${start || 0},${end ? (end - (start || 0)) : 2147483647}`;
    let conditionArr = [] as string[], conditionValues = [];
    if (search) conditionArr.push('MATCH(search) AGAINST(?)'), conditionValues.push(search);
    if (category) conditionArr.push('category = ?'), conditionValues.push(category);
    const wheresql = conditionArr.length ? `WHERE ${conditionArr.join(',')}` : '';
    const sql = `${wheresql} ${ordersql} ${limitsql}`;
    const cidsql = `SELECT id FROM \`atcoder.contestset\` ${wheresql} ${ordersql} ${limitsql}`;
    const contestset = await sotrage.newTableController('contestset');
    let data = await contestset.select<Contest[]>('id,title,link', sql, [...conditionValues, ...orderValues]);
    let problems = (await exec(conn,
        `SELECT cid,id,title,difficulty,link,\`index\` FROM \`atcoder.contestproblem\`,\`atcoder.problemset\` WHERE pid = id and cid IN (SELECT id FROM (${cidsql}) AS t)`,
        [...conditionValues, ...orderValues]
    )) as {
        cid: string,
        id: string,
        title: string,
        difficulty: number | null,
        link: string | null,
        index: string
    }[];
    const stats = await getArticleStats(
        conn,
        `SELECT id FROM \`atcoder.contestproblem\`,\`atcoder.problemset\` WHERE pid = id and cid IN (SELECT id FROM (${cidsql}) AS t)`,
        [...conditionValues, ...orderValues]
    );
    const problemset = {} as {[id: string]: ContestProblem[]};
    for (const problem of problems) {
        if (!problemset[problem.cid]) problemset[problem.cid] = [];
        problemset[problem.cid].push({index: problem.index, problem: {
            id: problem.id,
            title: problem.title,
            difficulty: problem.difficulty ? resolveDifficulty(problem.difficulty) : null,
            link: problem.link,
            articles: stats[problem.id] || [0, 0]
        }});
    }
    for (const i in data) data[i].problems = problemset[data[i].id] || [];
    return data;
}

export default {
    checkStorage,
    getContests,
    getProblems
} as Site;
/*
    function getIndexes(indexes: string[]) {
        let obj = {} as {[name: string]: string};
        for (const name of indexes) {
            const regex = name;
            regex.replace(/\//g, '|');
            obj[name] = `(${regex})\\d\*`;
        }
        return obj;
    }
    let categories = {
        abc: { id: "abc", title: "ABC", color: "#00f", contests: [], indexes: getIndexes(["A", "B", "C", "D", "E", "F", "G", "H/Ex"]) },
        arc: { id: "arc", title: "ARC", color: "#ff8000", contests: [], indexes: getIndexes(["A", "B", "C", "D", "E", "F"]) },
        agc: { id: "agc", title: "AGC", color: "#ff1818", contests: [], indexes: getIndexes(["A", "B", "C", "D", "E", "F"]) },
        abc_like: { id: "abc_like", title: "ABC Like", color: "#00f", contests: [], indexes: getIndexes(["A", "B", "C", "D", "E", "F", "G", "H/Ex"]) },
        arc_like: { id: "arc_like", title: "ARC Like", color: "#ff8000", contests: [], indexes: getIndexes(["A", "B", "C", "D", "E", "F"]) },
        agc_like: { id: "agc_like", title: "AGC Like", color: "#ff1818", contests: [], indexes: getIndexes(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) },
        ahc: { id: "ahc", title: "AHC", color: "#181818", contests: [] },
        others: { id: "others", title: "其他", color: "#181818", contests: [] }
    } as {[id: string]: Category};
*/