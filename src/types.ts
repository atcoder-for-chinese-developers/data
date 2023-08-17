import { Connection } from "mysql2";
import { SiteStorageController } from "./storage/storage";

export type Difficulty = {
    type: 'normal' | 'medal',
    color: string,
    textColor: string,
    rate: number,
    value: number
};

export type ContestProblem = {
    index: string,
    problem: Problem
};
export type Problem = {
    id: string,
    title: string,
    difficulty: Difficulty | null,
    link: string | null,
    articles: [number, number]
}

export type Contest = {
    id: string,
    title: string,
    link: string | null,
    problems: ContestProblem[];
};

export type Category = {
    id: string,
    title: string,
    color: string,
    contests: string[],
    indexes?: {[name: string]: string}
};
export type Modules = {
    [id: string]: any
};

export type Info = {
    title: string,
    icon: string,
    link: string
}

export type Orders = 'id' | 'id desc' | 'title' | 'title desc' | 'difficulty' | 'difficulty desc';

export type Data<T> = {
    status: 'ok' | 'error',
    data: T
};
export type Parameters = {
    start?: number,
    end?: number,
    category?: string,
    search?: string,
    maxDifficulty?: number,
    minDifficulty?: number,
    order?: Orders,
    pid?: string,
    type?: string,
    aid?: string
}
export type Site = {
    checkStorage: (conn: Connection) => Promise<SiteStorageController>
    [id: string]: (conn: Connection, storage: SiteStorageController, params: Parameters) => Promise<any>,
};
export type CommitInfo = {
    id: string,
    short: string,
    date: string
}
export type Article = {
    pid: string,
    site: string,
    id: string,
    type: string,
    title: string,
    tags?: string[],
    author?: string,
    created?: string,
    lastCommit: CommitInfo,
    rendered?: string
}
export type StoredArticle = {
    site: string,
    pid: string,
    type: string,
    id: string,
    title: string,
    author: string,
    created: Date,
    updated_time: Date,
    updated_commit: string,
    updated_commit_short: string,
    rendered: string
}
export type StoredArticleTags = {
    site: string,
    type: string,
    pid: string,
    id: string,
    tag: string
}