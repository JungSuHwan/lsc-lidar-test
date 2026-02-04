// src/server.ts
import Fastify, { FastifyInstance } from 'fastify';
import { LidarDriver, ScanData } from './LidarDriver';

const fastify: FastifyInstance = Fastify({ logger: true });
const lidar = new LidarDriver();

// 최신 스캔 데이터를 저장할 변수
let latestScanData: ScanData | null = null;

// 라이다 데이터 수신 이벤트 리스너
lidar.on('scan', (data: ScanData) => {
  latestScanData = data;
  // 로그가 너무 많을 수 있으니 카운터만 출력
  // console.log(`Received Scan Data: ${data.amountOfData} points`);
});

lidar.on('error', (err) => {
  fastify.log.error(err);
});

// --- API 라우트 정의 ---

// 1. 라이다 연결
fastify.post<{ Body: { ip: string; port?: number } }>('/connect', async (request, reply) => {
  const { ip, port } = request.body;
  try {
    if (lidar.isConnected()) {
      return { status: 'already_connected' };
    }
    await lidar.connect(ip, port || 8000);
    return { status: 'connected', ip, port: port || 8000 };
  } catch (err: any) {
    reply.code(500);
    return { status: 'error', message: err.message };
  }
});

// 2. 라이다 연결 해제
fastify.post('/disconnect', async (request, reply) => {
  lidar.disconnect();
  return { status: 'disconnected' };
});

// 3. 최신 스캔 데이터 조회
fastify.get('/scan', async (request, reply) => {
  if (!lidar.isConnected()) {
    reply.code(400);
    return { status: 'error', message: 'Lidar not connected' };
  }
  if (!latestScanData) {
    return { status: 'waiting_for_data' };
  }
  return latestScanData;
});

// 4. (옵션) 커맨드 전송 테스트 - 센서 시작/중지 등
// launch.py에 따르면 초기 연결 시 비밀번호 전송 등이 필요할 수 있음
fastify.post<{ Body: { command: string } }>('/command', async (request, reply) => {
  const { command } = request.body;
  try {
    // 실제 커맨드는 프로토콜 매뉴얼에 따라 framing 필요할 수 있음 (STX, Checksum 등)
    lidar.sendCommand(command);
    return { status: 'sent', command };
  } catch (err: any) {
    return { status: 'error', message: err.message };
  }
});

// 서버 시작
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server running at http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();