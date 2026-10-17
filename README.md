# JevHypa

RisuAI용 장기기억 플러그인 (API 3.0).
텍스트 생성 모델 없이 **TypeSafe Jev**(선택·판정 전용 모델)와 임베딩만으로 대화를 대단원 › 장면 › 사건 메모로 쌓고, 필요한 기억만 골라 메인 모델에 넣습니다.

## 설치

1. [`jevhypa.js`](https://raw.githubusercontent.com/happydesk213124/JevHypa/main/jevhypa.js)를 받습니다.
2. RisuAI → 설정 → 플러그인 → 플러그인 추가에서 파일을 고릅니다.
3. 우상단 🧠 버튼을 눌러 시작 안내에 따라 Jev·임베딩 키를 넣습니다.

## 자동 업데이트

파일 머리에 `//@update-url`이 들어 있어서, RisuAI가 이 저장소의 `main` 브랜치에 올라온 새 `//@version`을 감지하면 플러그인 목록에서 업데이트할 수 있습니다.

## JevMemory 2에서 옮겨 올 때

- 기존 **JevMemory 2** 플러그인은 끄거나 지우세요. 둘 다 켜 두면 기억이 두 번 들어갑니다.
- 기억·설정은 같은 저장 키를 쓰므로 그대로 이어집니다.
- 프롬프트의 `[jevmemory]` 자리 표시자도 계속 작동합니다. 새로 쓸 때는 `[jevhypa]`를 쓰면 됩니다.

## 새 버전 올리기 (관리자용)

`jevhypa.js` 4번째 줄의 `//@version`을 올린 뒤 `main`에 푸시하면 됩니다. 버전 줄은 파일 앞 512바이트 안에 있어야 합니다.
