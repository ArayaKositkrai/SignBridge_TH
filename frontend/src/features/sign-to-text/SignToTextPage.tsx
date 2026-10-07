import { useSearchParams } from "react-router-dom";
import PageTitle from "../../components/ui/PageTitle";
import { logEvent } from "../../lib/activityLog";
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
  // ?version=draft = ทดสอบโมเดลที่เทรนแล้วแต่ยังไม่เผยแพร่ (ปุ่ม "ทดสอบ Draft" ในหน้าแอดมิน)
  const [params] = useSearchParams();
  const version = params.get("version") === "draft" ? "draft" : "active";
  // การส่ง landmarks ไป backend และรับผลแปลกลับ
  const stream = useSignStream({
    frameRef: mp.frameRef,
    frameIdRef: mp.frameIdRef,
    enabled: on,
    aspect: cam.settings.width && cam.settings.height ? cam.settings.width / cam.settings.height : 16 / 9,
    version,
  });

  return (
    <>
    <PageTitle
      icon="hand"
      title="ภาษามือ → ข้อความ"
      subtitle="เปิดกล้องแล้วทำท่าภาษามือ ระบบจะต่อคำเป็นประโยคให้"
    />
    {version === "draft" && (
      <div className="mb-4 rounded-xl bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
        กำลังทดสอบโมเดล Draft (ยังไม่เผยแพร่ให้ผู้ใช้ทั่วไป)
      </div>
    )}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
      <CameraView
        videoRef={cam.videoRef}
        frameRef={mp.displayRef}
        camera={cam.status}
        cameraError={cam.error}
        facing={cam.facing}
        canFlip={cam.canFlip}
        model={mp.status}
        handsVisible={mp.handsVisible}
        bodyVisible={mp.bodyVisible}
        fps={mp.fps}
        onStart={() => {
          logEvent("เปิดกล้องแปลภาษามือ", version === "draft" ? "ทดสอบ Draft" : undefined);
          void cam.start();
        }}
        onStop={() => {
          logEvent("ปิดกล้องแปลภาษามือ");
          cam.stop();
        }}
        onFlip={() => {
          logEvent("สลับกล้อง");
          cam.flip();
        }}
      />
      <ResultPanel
        result={stream.result}
        notice={stream.notice}
        words={stream.words}
        sentences={stream.sentences}
        socket={stream.status}
        cameraOn={on}
        onSpeak={(t) => {
          logEvent("อ่านออกเสียงประโยค");
          speak(t);
        }}
        onRemoveLast={() => {
          logEvent("ลบคำล่าสุด");
          stream.removeLast();
        }}
        onCommit={() => {
          logEvent("กดจบประโยค");
          stream.commit();
        }}
        onClear={() => {
          logEvent("ล้างประโยค");
          stream.clear();
        }}
      />
    </div>
    </>
  );
}
