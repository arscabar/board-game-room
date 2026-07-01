# 로컬 웹호스팅

Northflank 결제수단 등록 전까지는 내 PC를 서버처럼 켜서 웹/모바일 브라우저에서 접속할 수 있습니다.

## 실행

처음 한 번:

```powershell
npm install
```

외부 접속 주소까지 한 번에 열기:

```powershell
npm run host:tunnel
```

이 명령은 아래 작업을 자동으로 합니다.

- React 앱 빌드
- 로컬 서버 실행
- Cloudflare Tunnel 실행
- `trycloudflare.com` 공개 주소 출력
- 공개 주소를 `.local-host/public-url.txt`에 저장
- 공개 주소를 클립보드에 복사

Docker로 실행하고 싶으면:

```powershell
npm run host:tunnel:docker
```

Docker 모드는 Docker Desktop이 꺼져 있으면 자동으로 실행하고, Docker가 준비될 때까지 기다린 뒤 이미지를 빌드하고 컨테이너를 띄웁니다.

웹 서버 실행:

```powershell
npm run host
```

이 명령은 React 앱을 빌드한 뒤 `Express + Socket.IO` 서버로 `dist` 파일을 함께 제공합니다.

## 접속 주소

내 PC에서:

```text
http://localhost:3001
```

같은 Wi-Fi의 휴대폰/다른 PC에서:

```text
http://서버PC-IP:3001
```

서버를 켜면 터미널에 아래처럼 LAN 주소가 같이 출력됩니다.

```text
Board Game Room server listening on http://localhost:3001
LAN access: http://192.168.0.12:3001
```

휴대폰에서는 `LAN access` 주소를 열면 됩니다.

## Windows 방화벽

처음 실행할 때 Windows가 Node.js 네트워크 허용을 물어보면 같은 Wi-Fi 접속을 위해 허용하세요.

허용하지 않았거나 접속이 안 되면 Windows 방화벽에서 Node.js 또는 포트 `3001` 인바운드 허용이 필요합니다.

## 개발 중 실행

코드를 수정하면서 바로 확인하려면:

```powershell
npm run dev
```

개발 서버 주소:

```text
http://localhost:5173
```

이 모드는 Vite 개발 서버와 Socket.IO 서버가 같이 뜹니다. 실제 배포/로컬 호스팅 확인은 `npm run host`가 더 정확합니다.

## 로컬 통계 저장

DB를 쓰지 않으면 전적은 기본적으로 로컬 파일에 저장됩니다.

```text
data/stats.json
```

이 파일은 GitHub에는 올라가지 않습니다. 로컬 테스트용으로만 쓰면 됩니다.

## Android 실기기 테스트

같은 Wi-Fi의 실제 휴대폰 앱에서 PC 서버를 보려면 빌드 전에 서버 PC IP를 넣습니다.

```powershell
$env:VITE_SOCKET_URL="http://서버PC-IP:3001"
$env:VITE_API_URL="http://서버PC-IP:3001"
npm run android:sync
```

Android 에뮬레이터만 쓸 때는 기본값 `http://10.0.2.2:3001`을 사용하므로 별도 설정 없이도 됩니다.

## 외부 인터넷 접속

같은 Wi-Fi 밖의 사람이 접속하려면 로컬 호스팅만으로는 부족합니다. 이때는 아래 중 하나가 필요합니다.

- Cloudflare Tunnel
- Northflank 같은 클라우드 배포
- 공유기 포트포워딩
- Tailscale, ngrok 같은 터널

친구들이 각자 다른 장소에서 접속해야 한다면 결국 Northflank 배포가 가장 깔끔합니다.

### Cloudflare Tunnel로 임시 공개

Cloudflare Quick Tunnel은 테스트/개발용 임시 공개 URL을 만들어 줍니다. 라우터 포트포워딩을 열 필요가 없고, HTTPS 주소가 자동으로 생깁니다.

가장 쉬운 방법:

```powershell
npm run host:tunnel
```

Docker까지 같이 쓰는 방법:

```powershell
npm run host:tunnel:docker
```

직접 나눠서 실행하려면 아래처럼 PowerShell 창 2개를 사용합니다.

먼저 로컬 서버를 켭니다.

```powershell
npm run host
```

다른 PowerShell 창에서 터널을 켭니다.

```powershell
npm run tunnel:cloudflare
```

또는 직접 실행:

```powershell
cloudflared tunnel --url http://localhost:3001
```

터미널에 아래처럼 `trycloudflare.com` 주소가 출력됩니다.

```text
https://random-name.trycloudflare.com
```

이 주소를 친구에게 보내면 같은 Wi-Fi가 아니어도 접속할 수 있습니다.

주의할 점:

- 내 PC가 켜져 있어야 합니다.
- `npm run host` 서버가 계속 켜져 있어야 합니다.
- `cloudflared` 터널 창도 계속 켜져 있어야 합니다.
- `npm run host:tunnel` 또는 `npm run host:tunnel:docker`는 PowerShell 창을 닫으면 같이 종료됩니다.
- Quick Tunnel은 Cloudflare 공식 문서상 테스트/개발용이며 SLA/업타임 보장은 없습니다.
- 주소가 임시라서 다시 실행하면 URL이 바뀔 수 있습니다.

즉 Cloudflare Tunnel은 “오늘 테스트용으로 외부 접속”에는 좋고, “PC를 꺼도 상시 운영”에는 Northflank가 맞습니다.

## 나중에 Northflank로 옮길 때

이미 준비된 파일:

- `Dockerfile`
- `.dockerignore`
- `DEPLOYMENT.md`
- `.env.example`

Northflank 환경변수는 DB 없이 먼저 시작하면 아래만 있으면 됩니다.

```text
PORT=3001
STATS_FILE=/tmp/board-game-stats.json
```

네트워킹:

```text
Internal Port: 3001
Protocol: HTTP
Public: Yes
Health Check: /api/health
```
