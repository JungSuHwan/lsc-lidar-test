// src/LidarDriver.ts
import net from 'net';
import { EventEmitter } from 'events';

// C++ 헤더의 Lsc_t 구조체와 유사한 타입 정의
export interface ScanData {
  scanCounter: number;
  scanFreq: number;
  measFreq: number;
  angleBegin: number;
  angleResol: number;
  amountOfData: number;
  ranges: number[]; // 거리 데이터 (m)
  rssi: number[];   // 강도 데이터
}

export class LidarDriver extends EventEmitter {
  private client: net.Socket;
  private connected: boolean = false;
  private buffer: Buffer = Buffer.alloc(0);

  // 프로토콜 상수 (socket.cpp, parser.cpp 참조)
  private readonly STX = 0x02;
  private readonly ETX = 0x03;

  constructor() {
    super();
    this.client = new net.Socket();

    this.client.on('data', (data) => this.handleData(data));
    this.client.on('close', () => {
      this.connected = false;
      console.log('Lidar disconnected');
      this.emit('disconnected');
    });
    this.client.on('error', (err) => {
      console.error('Lidar Socket Error:', err);
      this.emit('error', err);
    });
  }

  public connect(host: string, port: number = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.connect(port, host, () => {
        this.connected = true;
        console.log(`Connected to Lidar at ${host}:${port}`);
        resolve();
      });
      this.client.on('error', (err) => reject(err));
    });
  }

  public disconnect() {
    this.client.destroy();
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  // C++의 autolidar.cpp 구현부가 없으므로, parser 로직을 역추적하여 전송 포맷 추정
  // 일반적인 Autonics 프로토콜: STX + Length(Hex) + , + Command + ... + ETX
  public sendCommand(cmd: string) {
    if (!this.connected) throw new Error('Not connected');

    // 실제 프로토콜에 맞게 커맨드 패킹이 필요할 수 있습니다.
    // 여기서는 Raw String을 보내는 예시로 작성합니다. 
    // 실제 장비에 따라 framing(STX/ETX/Length)이 필요할 수 있습니다.
    // 예: this.client.write(Buffer.from([0x02, ...cmdBytes, 0x03]));
    this.client.write(cmd);
  }

  // 데이터 수신 및 파싱 (parser.cpp의 AsciiParser::parsingMsg 포팅)
  private handleData(chunk: Buffer) {
    // TCP 패킷이 쪼개져서 오거나 붙어서 올 수 있으므로 버퍼링 처리
    this.buffer = Buffer.concat([this.buffer, chunk]);

    let stxIndex = this.buffer.indexOf(this.STX);
    while (stxIndex !== -1) {
      const etxIndex = this.buffer.indexOf(this.ETX, stxIndex);
      
      if (etxIndex !== -1) {
        // 완전한 패킷 발견
        const packet = this.buffer.subarray(stxIndex + 1, etxIndex); // STX, ETX 제외
        this.parsePacket(packet);

        // 처리된 패킷 제거
        this.buffer = this.buffer.subarray(etxIndex + 1);
        stxIndex = this.buffer.indexOf(this.STX);
      } else {
        // ETX가 아직 안 왔으므로 대기 (데이터가 더 필요함)
        break;
      }
    }
  }

  private parsePacket(packet: Buffer) {
    const msg = packet.toString('ascii');
    const fields = msg.split(',');

    // parser.cpp 로직 참조
    // fields 구조: [Length, CmdType, Command, ..., Data...]
    
    // 예: Command가 "ScanData"인지 확인 (C++ 코드상 인덱스 확인 필요)
    // parser.cpp: field[index] == "ScanData" (실제로는 인덱스가 유동적일 수 있음)
    
    // 간단한 파싱 예제: "ScanData" 키워드가 포함되어 있으면 스캔 데이터로 간주
    if (fields.includes('ScanData')) {
      try {
        const scanData = this.parseScanData(fields);
        this.emit('scan', scanData);
      } catch (e) {
        console.error('Error parsing scan data:', e);
      }
    } else {
        // 기타 응답 (Command Echo 등)
        console.log('Received Msg:', msg);
    }
  }

  // parser.cpp의 case SCAN_DATA 부분 포팅
  private parseScanData(fields: string[]): ScanData {
    // fields 배열에서 필요한 인덱스를 찾아야 함.
    // C++ 코드: 
    // field[7] -> scan_counter
    // field[10] -> scan_freq
    // field[14] -> amnt_of_data (데이터 개수)
    // 그 뒤 "DIST1" 문자열 이후부터 거리 데이터 시작

    const scanCounter = parseInt(fields[7], 16);
    const scanFreq = parseInt(fields[10], 16);
    const measFreq = parseInt(fields[11], 16);
    const angleBegin = parseInt(fields[12], 16); // 부호있는 정수 처리가 필요할 수 있음
    const angleResol = parseInt(fields[13], 16);
    const amountOfData = parseInt(fields[14], 16);

    const result: ScanData = {
      scanCounter,
      scanFreq,
      measFreq,
      angleBegin,
      angleResol,
      amountOfData,
      ranges: [],
      rssi: []
    };

    // DIST1 찾기
    let index = fields.indexOf('DIST1');
    if (index !== -1) {
      index++; // 'DIST1' 다음부터 데이터
      for (let i = 0; i < amountOfData; i++) {
        if (index >= fields.length) break;
        // C++: (float) (strtoul(...) / 1000.0)
        const distHex = fields[index++];
        const distM = parseInt(distHex, 16) / 1000.0;
        result.ranges.push(distM);
      }
    }

    // RSSI1 찾기
    index = fields.indexOf('RSSI1');
    if (index !== -1) {
      index++;
      for (let i = 0; i < amountOfData; i++) {
        if (index >= fields.length) break;
        // C++: (float) strtoul(...)
        const rssiHex = fields[index++];
        result.rssi.push(parseInt(rssiHex, 16));
      }
    }

    return result;
  }
}