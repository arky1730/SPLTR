import { AudioLines, Download, ExternalLink, Film, FolderOpen, Scissors, Split, X } from "lucide-react";
import { useEffect } from "react";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
  onOpenCreator: () => void;
}

const STEPS = [
  { icon: AudioLines, title: "1. 오디오 추가", body: "MP3, WAV, FLAC, M4A, AIFF, OGG 파일이나 폴더를 드래그하세요. 폴더 안의 음원도 자동으로 찾습니다." },
  { icon: Split, title: "2. 보컬 분리", body: "Separate를 누르면 보컬과 반주를 PC 안에서 분리합니다. GPU가 없으면 CPU로 자동 전환됩니다." },
  { icon: FolderOpen, title: "3. 결과 확인", body: "완료된 곡을 선택해 Original, Vocals, Instrumental을 비교하고 Show in folder로 저장 폴더를 여세요." },
  { icon: Scissors, title: "4. 클립 편집", body: "파형을 클릭하거나 흰 재생 헤드를 끌어 탐색하세요. 양끝 핸들로 자르고 무음과 페이드 인·아웃을 조절할 수 있습니다." },
  { icon: Download, title: "5. 내보내기", body: "편집한 구간을 WAV·MP3 오디오 또는 480p 검은 화면 MP4로 저장합니다. 기존 파일은 덮어쓰지 않습니다." },
  { icon: Film, title: "6. 동영상 오디오 추출", body: "왼쪽 아래 Video → Audio에서 동영상을 선택하고 WAV 또는 MP3로 오디오만 추출하세요." },
];

export function HelpModal({ open, onClose, onOpenCreator }: HelpModalProps) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="help-shade" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="help-card" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header className="help-head">
          <div><span>QUICK START</span><h2 id="help-title">SPLTR 간단 사용법</h2></div>
          <button className="round-button" aria-label="사용법 닫기" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="help-intro">
          <strong>드래그 → 분리 → 확인 → 저장</strong>
          <p>오디오는 외부로 전송되지 않으며 모든 처리는 사용자의 PC에서 진행됩니다.</p>
        </div>
        <div className="help-steps">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <article key={title}><Icon size={17} /><div><strong>{title}</strong><p>{body}</p></div></article>
          ))}
        </div>
        <div className="help-note">
          <div><strong>처음 사용할 때</strong><span>AI 런타임과 선택한 모델을 한 번 다운로드합니다. 이후에는 캐시를 재사용합니다.</span></div>
          <button onClick={onOpenCreator}>만든이 · @r2voltz <ExternalLink size={13} /></button>
        </div>
      </section>
    </div>
  );
}
