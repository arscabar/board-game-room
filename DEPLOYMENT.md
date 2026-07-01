# 배포와 통계 저장 설정

이 앱은 React 정적 파일만 올리는 구조가 아니라 `Express + Socket.IO` 서버가 방 상태를 유지합니다. 그래서 정적 호스팅 단독보다 WebSocket을 지원하는 장기 실행 Node 서버가 필요합니다.

## 무료 사용 가능성

2026-07-01 확인 기준입니다. 가격과 제한은 자주 바뀌므로 배포 직전 공식 문서를 다시 확인하세요.

- 추천 1순위 - Northflank: Sandbox에 Always-on compute, no sleeping, 무료 서비스 2개, 무료 DB 1개가 명시돼 있습니다. 공식 네트워크 문서도 HTTP/HTTP2 WebSockets를 지원한다고 안내합니다. 지금 같은 Node/Express/Socket.IO 서버와 DB 1개 구성에 가장 잘 맞습니다.  
  https://northflank.com/pricing  
  https://northflank.com/docs/v1/application/network/networking-on-northflank
- 추천 2순위 - Koyeb: 무료 웹 서비스 1개를 제공하고, 공식 FAQ 기준 512MB RAM / 0.1 vCPU / 2GB SSD입니다. Socket.IO + Node.js 튜토리얼이 있어 배포 흐름은 잘 맞지만, 리소스가 작으므로 친구끼리 테스트하거나 소규모로 플레이하는 용도에 가깝습니다. 무료 Postgres도 있으나 active time 제한이 있으니 운영 전 확인이 필요합니다.  
  https://www.koyeb.com/docs/faqs/pricing  
  https://www.koyeb.com/tutorials/using-websockets-with-socketio-and-nodejs-on-koyeb
- Render: Web Service에서 WebSocket을 받을 수 있고 무료 Web Service/무료 Postgres 옵션이 있습니다. 무료 인스턴스는 제한과 슬립이 있으므로 취미/테스트용에 적합합니다.  
  https://render.com/docs/websocket  
  https://render.com/docs/free
- Railway: Socket.IO 배포 가이드를 제공하지만 무료는 크레딧/트라이얼 성격이 강합니다.  
  https://docs.railway.com/guides/socketio  
  https://docs.railway.com/pricing/plans
- Fly.io: Node 앱 배포가 가능하지만 공식 문서상 일반적인 “영구 무료 티어”라기보다 free trial/usage 기반에 가깝습니다.  
  https://fly.io/docs/js/  
  https://fly.io/docs/about/pricing/
- Vercel: WebSockets 문서가 있지만 현재 앱은 Express + Socket.IO 장기 실행 서버라 그대로 올리기에는 Render/Railway/Fly 쪽이 단순합니다.  
  https://vercel.com/docs/functions/websockets
- Supabase: Postgres 무료 플랜이 있어 전적 저장용 DB로 붙이기 좋습니다.  
  https://supabase.com/pricing

## 추천 구성

처음 배포는 Northflank에 서비스 1개만 올리는 구성이 가장 단순합니다. 전적/승률이 서버 재시작 후에도 남아야 할 때만 Postgres DB를 추가하세요.

```text
필수: 서비스 1개 - Node/Express/Socket.IO + React dist 서빙
선택: DB 1개 - Postgres, DATABASE_URL로 연결
공개 포트: 3001, HTTP, public
헬스체크: /api/health
```

이 프로젝트에는 `Dockerfile`이 들어 있으므로 Northflank, Koyeb, Render, Fly 계열에서 컨테이너 빌드 방식으로 올릴 수 있습니다. Dockerfile을 쓰지 않는 경우에도 build command와 start command는 동일합니다.

```text
Build Command: npm ci && npm run build
Start Command: npm start
Health Check Path: /api/health
Node Version: 22.21.1 이상
```

## Northflank 배포

1. GitHub에 이 프로젝트를 올립니다.
2. Northflank에서 새 프로젝트를 만들고 `Service` 또는 `Combined Service`를 생성합니다.
3. Repository를 연결하고 Dockerfile 빌드 또는 Buildpack 빌드를 선택합니다.
4. 공개 포트를 추가합니다.

```text
Internal Port: 3001
Protocol: HTTP
Public: Yes
```

5. DB 없이 먼저 쓸 경우 환경변수는 아래처럼 둡니다.

```text
PORT=3001
STATS_FILE=/tmp/board-game-stats.json
```

이 모드는 방 상태, 접속 플레이어, 진행 중 점수, 최근 전적이 서버가 살아 있는 동안만 유지됩니다. 서버가 재배포되거나 재시작되면 방과 통계가 초기화될 수 있습니다.

6. 전적/승률을 계속 보관하고 싶을 때만 Northflank Postgres addon을 만들고 연결 문자열을 서비스 환경변수에 넣습니다.

```text
DATABASE_URL=postgresql://...
DATABASE_SSL=true
PORT=3001
```

7. 배포 후 아래 주소가 정상 응답하면 서버가 준비된 것입니다.

```text
https://your-northflank-domain/api/health
```

Northflank의 DB를 쓰면 전적/승률/최근 경기가 서버 재시작 후에도 유지됩니다. `DATABASE_URL`을 넣지 않으면 파일 기반 임시 저장소를 쓰며, 이 방식은 재배포 때 사라질 수 있어 장기 기록용으로는 권장하지 않습니다.

## Koyeb 배포

1. GitHub 저장소를 Koyeb Service로 연결합니다.
2. Instance type은 `free`로 시작할 수 있습니다.
3. Dockerfile을 사용하거나 Node 빌드를 사용합니다.
4. 환경변수를 지정합니다.

```text
DATABASE_URL=postgresql://...
DATABASE_SSL=true
```

Koyeb 무료 웹 서비스는 리소스가 작으므로 동시에 여러 방이 오래 열리는 사용에는 한계가 있을 수 있습니다. 소규모 테스트 후 방 수와 접속자 수가 늘어나면 Northflank 유료 compute, Render/Railway/Fly, 또는 VPS로 옮기는 편이 안전합니다.

## Render 배포

1. GitHub에 이 프로젝트를 올립니다.
2. Render에서 `New Web Service`를 만들고 저장소를 연결합니다.
3. 설정값은 `render.yaml`을 사용하거나 아래처럼 직접 입력합니다.

```text
Build Command: npm ci && npm run build
Start Command: npm start
Health Check Path: /api/health
Node Version: 22.21.1 이상
```

4. 전적을 서버 재시작 후에도 유지하려면 환경변수에 Postgres 연결 문자열을 넣습니다.

```text
DATABASE_URL=postgresql://...
DATABASE_SSL=true
```

`DATABASE_URL`이 없으면 개발용으로 `data/stats.json`에 저장됩니다. 무료 Web Service의 로컬 파일은 재배포/재시작 상황에서 영구 저장소로 믿기 어렵기 때문에 운영 통계에는 DB를 권장합니다.

## Supabase 통계 DB

1. Supabase 프로젝트를 만듭니다.
2. Project Settings에서 Postgres connection string을 복사합니다.
3. Northflank/Koyeb/Render/Railway/Fly 환경변수 `DATABASE_URL`에 붙여넣습니다.
4. 서버가 처음 켜질 때 아래 테이블을 자동 생성합니다.

- `board_game_matches`: 완료된 경기 원본 기록
- `board_game_player_stats`: 플레이어 이름 + 게임별 누적 전적

## Android 앱 빌드

웹과 Android 앱이 배포 서버를 보도록 빌드 시점에 URL을 지정합니다.

```powershell
$env:VITE_SOCKET_URL="https://your-server.example.com"
$env:VITE_API_URL="https://your-server.example.com"
npm run android:sync
```

로컬 Android 에뮬레이터 테스트는 기본값 `http://10.0.2.2:3001`을 사용합니다.

## 현재 저장되는 통계

- 플레이어 이름별 전체 전적
- 게임별 플레이 횟수, 승/패/무, 승률
- 점수/승수 게임의 평균 점수와 최고점
- 최근 경기 기록
- 메인 화면 랭킹과 내 전적

현재는 로그인 계정이 없으므로 같은 이름은 같은 플레이어로 합산됩니다. 나중에 계정 로그인을 붙이면 `playerKey`를 사용자 ID 기반으로 바꾸면 됩니다.
