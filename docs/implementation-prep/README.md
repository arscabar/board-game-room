# 신규 게임 3종 구현 준비 패키지

작성일: 2026-07-14

이 디렉터리는 조사 결과를 실제 구현 작업으로 옮기기 위한 기준 문서다. 아직 공식 디지털 라이선스가 확인되지 않았으므로 내부 작업명과 독자 에셋을 사용한다.

| 조사 대상 | 내부 작업 ID | 내부 작업명 | MVP 인원 | 구현 순서 |
|---|---|---|---:|---:|
| 인디언 포커 계열 | `blind-card-duel` | 페이스아웃 듀얼 | 2 | 1 |
| 타이거 앤 드래곤 계열 | `parity-tile-duel` | 문양 공방 | 2–4 | 2 |
| 우봉고 계열 | `mosaic-rush` | 모자이크 러시 | 1–4 | 3 |

내부 ID는 기술 준비용이며 공개 제품명으로 사용할 수 있다는 뜻이 아니다. 상표 확인과 라이선스 결정 뒤 최종 이름을 확정한다.

## 문서 구성

- [00-platform-foundation.md](00-platform-foundation.md): 세 게임이 공통으로 요구하는 서버·클라이언트 기반
- [01-blind-card-duel.md](01-blind-card-duel.md): 2인 블라인드 숫자카드 베팅 게임
- [02-parity-tile-duel.md](02-parity-tile-duel.md): 공격·방어·패스 타일 게임
- [03-mosaic-rush.md](03-mosaic-rush.md): 동시 진행 폴리오미노 퍼즐 게임
- [04-asset-and-content-ledger.md](04-asset-and-content-ledger.md): 에셋·콘텐츠 제작 및 권리 장부
- [three-games-rules-design-research-2026-07-14.md](../three-games-rules-design-research-2026-07-14.md): 규칙·디자인·출처 조사 원문

## 이번 준비 단계에서 확정한 범위

- 공통 엔진을 먼저 보강한 뒤 게임 모듈을 순차 구현한다.
- 첫 출시에서는 현재 방 상한을 유지해 최대 4명만 지원한다.
- 관전 기능은 MVP에서 제공하지 않는다. `viewerId: null`에도 숨은 정보가 안전한지만 테스트한다.
- 서버 재시작 이후 경기 복구는 MVP 밖이다. 현재 방이 살아 있는 동안의 새로고침·재접속은 지원한다.
- 공식 퍼즐, 로고, 상자, 타일·카드 그래픽, 방송 화면은 저장소에 넣지 않는다.
- 타이거 앤 드래곤의 공식 전장 점수 데이터는 라이선스 또는 계약 판본 검증 전 코드에 고정하지 않는다. 엔진 테스트에는 독자 fixture를 사용한다.

## 구현 착수 게이트

다음 조건이 모두 충족되어야 게임 모듈 코딩에 들어간다.

- [ ] `GameActionEnvelope`의 revision·actionId 정책 승인
- [ ] RNG·서버 시계 주입 API 승인
- [ ] 동시 행동 capability와 예약 이벤트 API 승인
- [ ] 세 게임의 하우스 룰 상수 확정
- [ ] 공개/비공개 상태 표와 관전자 정책 확정
- [ ] 내부 작업명과 독자 임시 에셋 사용 승인
- [ ] 게임별 테스트 fixture와 완료 기준 승인

## 목표 품질

- 모든 승패·점수·셔플·타이머 판정은 서버 권위다.
- 숨은 정보 값은 허용되지 않은 클라이언트의 JSON, DOM, 접근성 트리, 로그에 존재하지 않는다.
- 액션 재전송은 상태를 두 번 변경하지 않는다.
- 모든 게임은 새로고침 후 같은 좌석과 허용 정보로 복귀한다.
- 360px 모바일, 키보드 전용, `prefers-reduced-motion`, 200% 확대를 통과한다.
- `npm run build`, `npm run qa:catalog`, `npm run qa:games`, `npm run qa:privacy`, `npm run qa:timeouts`를 통과한다.
