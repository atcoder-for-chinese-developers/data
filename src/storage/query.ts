import mysql, { Connection, PrepareStatementInfo } from 'mysql2';

export function newConnection() {
  return mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT as string),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_USER_PASSWORD,
    database: process.env.DATABASE_NAME
  });
}

export function query(conn: Connection, sql: string, values?: any) {
  return new Promise((resolve, reject) => {
//    console.log('查询 SQL:', sql);
//    if (values) console.log('值:', values);
    conn.query(sql, values, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  })
}

export async function exec(conn: Connection, sql: string, values?: any) {
//  console.log('执行 SQL:', sql);
//  if (values) console.log('值:', values);
  const statement = await prepare(conn, sql);
  const data = preparedExec(statement, values);
  unprepare(conn, sql);
  return data;
}

export function prepare(conn: Connection, sql: string): Promise<PrepareStatementInfo> {
  return new Promise((resolve, reject) => {
//    console.log('预处理:', sql);
    conn.prepare(sql, (err, statement) => {
      if (err) reject(err);
      else resolve(statement);
    })
  });
}

export function unprepare(conn: Connection, sql: string) {
//  console.log('清除预处理:', sql);
  conn.unprepare(sql);
}

export function preparedExec(statement: PrepareStatementInfo, value: any) {
  return new Promise((resolve, reject) => {
    statement.execute(value, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    })
  })
}
