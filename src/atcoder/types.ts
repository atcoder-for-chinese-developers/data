export type NativeContest = {
    id: string,
    start_epoch_second: number,
    duration_second: number,
    title: string,
    rate_change: string
};

export type NativeProblem = {
    id: string,
    contest_id: string,
    problem_index: string,
    name: string,
    title: string
};

export type NativeDifficulty = {
    slope: number,
    intercept: number,
    variance: number,
    difficulty: number,
    discrimination: number,
    irt_loglikelihood: number,
    irt_users: number,
    is_experimental: boolean
};
export type NativeDifficultySet = {
    [id: string]: NativeDifficulty
};

export type NativeContestProblem = {
    contest_id: string,
    problem_id: string,
    problem_index: string
};


export type StoredProblem = {
  id: string,
  title: string,
  link: string | null,
  difficulty: number | null,
  date: Date,
  search: string
};

export type StoredContest = {
  id: string,
  title: string,
  link: string | null,
  problems: StoredContestProblem[],
  category: string,
  date: Date,
  search: string
};

export type StoredContestProblem = {
  pid: string,
  index: string
};
