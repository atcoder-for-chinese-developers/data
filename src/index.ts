import net from 'net';
import { Data, Parameters } from './types.ts';
import { exec } from './sites.ts';

function randomID(): string {
  const charset = '0123456789abcdef';
  let str = '';
  for (let i = 0; i < 8; i++) str += charset[Math.floor(Math.random() * 16)];
  return str;
}
const server = net.createServer((socket) => {
  const id = randomID();
  console.log('新连接', id);
  socket.on('end', () => console.log('连接断开', id));
  socket.on('data', async (data) => {
    try {
      const request = JSON.parse(data.toString());
      console.log('从', id, '发来数据', request);
      const res = await exec(request.site as string, request.method as string, request.params as Parameters);
      socket.write(JSON.stringify({status: 'ok', data: res} as Data<any>));
      console.log('成功响应', id);
    } catch (err: any) {
      const message = err.message || 'An error with no detail occurred.';
      socket.write(JSON.stringify({status: 'error', data: message} as Data<string>));
      console.log('响应', id, '失败:', message);
    }
  });
  socket.on('error', err => {
    socket.write(JSON.stringify({status: 'error', data: err} as Data<Error>));
  });
});

server.on('listening', () => {
  console.log('监听', server.address());
});

server.listen(process.env.PORT || 4000);
