# SPLTR 빠른 사용 설명서

SPLTR은 음원을 외부로 전송하지 않고 Windows PC 안에서 보컬과 반주를 분리하는 앱입니다.

## 1. 오디오 추가

메인 화면에 MP3, WAV, FLAC, M4A, AIFF, OGG 파일을 드래그하거나 **Browse**를 누릅니다. 여러 파일과 폴더도 추가할 수 있으며 폴더는 하위 폴더까지 검색합니다.

## 2. 보컬 분리

대기열을 확인하고 **Separate**를 누릅니다. NVIDIA CUDA GPU를 자동으로 감지하며 사용할 수 없으면 CPU로 전환합니다. 처음 실행할 때는 AI 런타임과 선택한 Demucs 모델을 한 번 다운로드합니다.

## 3. 결과 듣기와 저장 위치

완료된 곡을 선택한 뒤 **Original**, **Vocals**, **Instrumental**을 눌러 같은 위치에서 비교합니다. **Show in folder**를 누르면 결과 폴더가 열립니다.

기본 출력은 원본 음원이 있는 폴더입니다. Settings에서 별도 폴더를 지정할 수 있으며 기존 파일은 덮어쓰지 않고 `(1)`, `(2)`를 붙입니다.

## 4. 클립 편집

- 출력 길이는 4초부터 30초까지 선택합니다.
- 파형을 클릭하거나 흰 재생 헤드를 드래그해 탐색합니다.
- 양쪽 보라색 핸들로 시작과 끝을 자릅니다.
- **Lead silence**, **End silence**로 앞뒤 무음을 만듭니다.
- 초록색 핸들로 페이드 인과 페이드 아웃 길이를 조절합니다.
- 확대 버튼으로 파형 구간을 자세히 볼 수 있습니다.

## 5. 내보내기

현재 선택한 Original, Vocals, Instrumental 트랙을 다음 형식으로 저장할 수 있습니다.

- **Export audio:** 24-bit WAV 또는 320 kbps MP3
- **Black MP4:** 854×480 검은 화면 H.264/AAC 영상

클립의 무음과 페이드는 오디오와 MP4에 동일하게 적용됩니다.

## 6. 동영상에서 오디오 추출

왼쪽 아래 **Video → Audio**에서 MP4, MOV, MKV, AVI, WebM, M4V 파일을 선택합니다. WAV 또는 MP3 형식을 고르고 **Extract audio**를 누릅니다.

## 문제 해결

- GPU 메모리 부족: 병렬 작업을 1개로 줄이거나 CPU를 선택합니다.
- 모델 다운로드 실패: 인터넷과 방화벽을 확인한 뒤 Retry를 누릅니다.
- 지원되지 않거나 손상된 음원: 다른 편집 프로그램에서 WAV로 다시 저장해 시도합니다.
- 로그 위치: `%APPDATA%\app.spltr.desktop\logs`

## 만든이

[Threads · @r2voltz](https://www.threads.com/@r2voltz?hl=ko)
