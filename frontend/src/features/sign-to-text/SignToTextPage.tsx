import PageTitle from "../../components/ui/PageTitle";
import { useCamera } from "../../hooks/useCamera";
import { speak } from "../../lib/tts";
import CameraView from "./components/CameraView";
import ResultPanel from "./components/ResultPanel";
import { useMediaPipe } from "./hooks/useMediaPipe";
import { useSignStream } from "./hooks/useSignStream";

// หน้าภาษามือ -> ข้อความ: เปิดกล้อง จับท่า ส่งไป backend แล้วแสดงผล
export default function SignToTextPage() {
  // กล้อง
  const cam = useCamera();
  const on = cam.status === "on";
  // โมเดลตรวจจับท่าทาง (MediaPipe)
  const mp = useMediaPipe({ videoRef: cam.videoRef, active: on });
  // การส่ง landmarks ไป backend และรับผลแปลกลับ
  const stream = useSignStream({
    frameRef: mp.frameRef,
    frameIdRef: mp.frameIdRef,
    enabled: on,
  });

  return (
    <>
    <PageTitle
      icon="hand"
      title="ภาษามือ → ข้อความ"
      subtitle="เปิดกล้องแล้วทำท่าภาษามือ ระบบจะต่อคำเป็นประโยคให้"
    />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
      <CameraView
        videoRef={cam.videoRef}
        frameRef={mp.frameRef}
        camera={cam.status}
        cameraError={cam.error}
        facing={cam.facing}
        canFlip={cam.canFlip}
        model={mp.status}
        handsVisible={mp.handsVisible}
        bodyVisible={mp.bodyVisible}
        onStart={() => void cam.start()}
        onStop={cam.stop}
        onFlip={cam.flip}
      />
      <ResultPanel
        result={stream.result}
        words={stream.words}
        sentences={stream.sentences}
        socket={stream.status}
        cameraOn={on}
        onSpeak={speak}
        onCommit={stream.commit}
        onClear={stream.clear}
      />
    </div>
    </>
  );
}
