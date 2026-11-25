import { useEffect, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { applyPose, posedBones } from "../../../lib/avatar3d/rig";
import { loadRig, type Rig } from "../../../lib/avatar3d/loadModel";
import { HEAD_BONE } from "../../../lib/avatar3d/bones";
import { createFaceMesh, createFaceTexture, drawFace } from "../../../lib/avatar3d/face";
import { applyVrmFace, findFaceMeshes } from "../../../lib/avatar3d/vrmFace";
import { SHOULDER, sampleFace, sampleMotion } from "../../../lib/avatar/skeleton";
import type { Motion } from "../../../types";
import SkeletonAvatar from "./SkeletonAvatar";

interface Props {
  motion: Motion | null | undefined;
  progressRef: MutableRefObject<number>;
  // true = แสดงแบบกระจก (กลับภาพซ้าย-ขวา มือขวาของตัวละครอยู่ฝั่งขวาจอ ทำตามได้เหมือนส่องกระจก)
  mirror?: boolean;
}

// ลากเมาส์/นิ้วบนตัวละครเพื่อหมุนกล้องรอบตัวได้ 360 องศา (ตัวละครไม่ได้หมุน ท่าทางและการคำนวณแขนจึงไม่เปลี่ยน) ดับเบิลคลิกเพื่อกลับมาหน้าตรง
const DRAG_RAD_PER_PX = 0.01;

type Status = "loading" | "ready" | "error";

// กรอบกล้อง (พิกัด 0-1 แบบเดียวกับที่ใช้กำหนดท่ามือใน motion_library.py):
// เผื่อขอบไว้กว้างเพราะท่าที่สร้างจากคลิปจริงยกมือเหนือหัวและลดแขนต่ำกว่าเอวได้
// (ท่าจริงมือสูงสุด y≈-0.04 "พ่อมด" ต่ำสุด y≈0.77 "เพื่อน" บวกความยาวนิ้ว เดิม 0.02-0.68 จึงหลุดเฟรม)
const FRAME_TOP_UNIT = -0.14;
const FRAME_BOTTOM_UNIT = 0.87;
// ความกว้างที่ต้องเห็นเสมอ (หน่วยเดียวกัน) กันแขนที่กางออกข้างหลุดเฟรมเมื่อกล่องแคบ เช่นจอมือถือแนวตั้ง
const FRAME_WIDTH_UNIT = 1.05;
// เวลาที่ใช้ไล่ท่าให้ทันท่าใหม่ (วินาที) ยิ่งน้อยยิ่งตามไว ช่วยกันมือ/นิ้วกระตุกหรือหมุนวูบเมื่อท่าเปลี่ยนเร็ว
const POSE_SMOOTH_SEC = 0.06;

// ตัวละครโมเดล 3D (VRM ถ้ามี /models/avatar.vrm ไม่งั้น X Bot จาก Mixamo) ขยับแขน มือ นิ้ว และเอียงหัวตามท่าทางปัจจุบัน
// ถ้าโหลดโมเดลไม่สำเร็จ จะตกไปใช้ตัวโครงกระดูก 2D แทนโดยอัตโนมัติ
export default function Avatar3D({ motion, progressRef, mirror = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef(motion);
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;
  motionRef.current = motion;
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;

    loadRig()
      .then((rig) => {
        if (cancelled) return;
        setStatus("ready");
        stop = startScene(containerRef.current!, rig, motionRef, progressRef, mirrorRef);
      })
      .catch((err) => {
        console.error("โหลดโมเดล 3D ไม่สำเร็จ", err);
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "error") return <SkeletonAvatar motion={motion} progressRef={progressRef} />;

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className={`absolute inset-0 cursor-grab touch-none active:cursor-grabbing ${mirror ? "-scale-x-100" : ""}`} data-testid="avatar3d-container" />
      {status === "ready" && (
        <span className="pointer-events-none absolute bottom-2 right-3 select-none text-[11px] text-white/45">ลากเพื่อหมุนดู · ดับเบิลคลิกเพื่อรีเซ็ต</span>
      )}
      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center text-sky/70">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky/30 border-t-sky" />
        </div>
      )}
    </div>
  );
}

// ตั้งฉาก กล้อง แสง โหลดโมเดลเข้าฉาก แล้ววนอัปเดตท่าทางทุกเฟรม คืนฟังก์ชันไว้หยุด/เก็บกวาดตอน unmount
function startScene(
  container: HTMLElement,
  rig: Rig,
  motionRef: MutableRefObject<Motion | null | undefined>,
  progressRef: MutableRefObject<number>,
  mirrorRef: MutableRefObject<boolean>,
): () => void {
  const scene = new THREE.Scene();
  scene.add(rig.root);

  // แสงอยู่ในกลุ่มเดียวกันและหมุนตามกล้อง (ตอนผู้ใช้หมุนดูรอบตัว แสงจะตามไปส่องด้านที่กำลังดู ไม่มืดด้านหลัง)
  const lights = new THREE.Group();
  scene.add(lights);
  if (rig.vrm) {
    // วัสดุ VRM (MToon) ตอบสนองต่อแสงแรงกว่าหุ่นเทา: ใช้แสงขาวจากด้านหน้า (ไม่มีแสงฟ้าด้านหลัง) ให้สีผิวสว่างและเห็นนิ้ว/หน้าชัด
    // ถ้าจะปรับความสว่าง ลองขยับค่าสามตัวนี้ (มากเกินไปจะขาวไหม้)
    lights.add(new THREE.AmbientLight(0xffffff, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(0.8, 1.6, 3);
    lights.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1.5, 0.6, 2.5);
    lights.add(fill);
  } else {
    lights.add(new THREE.AmbientLight(0xbbd6e1, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1.2, 2.2, 2.4);
    lights.add(key);
    const rim = new THREE.DirectionalLight(0x3885ab, 0.9);
    rim.position.set(-1.4, 1.4, -2);
    lights.add(rim);
  }

  // ตั้งกล้องให้เห็นครึ่งตัวเต็มเฟรม โดยคำนวณจากกรอบบน-ล่างในพิกัด 0-1 เดียวกับที่ใช้
  // กำหนดท่ามือ (ไม่ใช่เดาสัดส่วนตัวโมเดลเอาเอง) จึงครอบคลุมทุกท่าได้จริงไม่ว่ายกมือสูงแค่ไหน
  // แนวกึ่งกลางแนวนอนอยู่ที่ lookAt.x = 0 เสมอ ให้ตัวละครอยู่กึ่งกลางจอไม่ว่าสัดส่วนกล่องจะเป็นเท่าไร
  const anchorUnitY = SHOULDER.r.y;
  const unitToReal = (unitY: number) => rig.frame.chest.y - (unitY - anchorUnitY) * rig.armScale;
  const visibleHeight = (FRAME_BOTTOM_UNIT - FRAME_TOP_UNIT) * rig.armScale;
  const midY = (unitToReal(FRAME_TOP_UNIT) + unitToReal(FRAME_BOTTOM_UNIT)) / 2;
  const visibleWidth = FRAME_WIDTH_UNIT * rig.armScale;
  const fovDeg = 32;
  const halfTan = Math.tan((fovDeg * Math.PI) / 360);
  // ระยะกล้องที่เห็นทั้งความสูงและความกว้างที่ต้องการ ตามสัดส่วนกล่อง (กว้าง/สูง)
  const distanceFor = (aspect: number) => Math.max(visibleHeight, visibleWidth / aspect) / 2 / halfTan;
  const lookAt = new THREE.Vector3(0, midY, rig.frame.chest.z);
  const camera = new THREE.PerspectiveCamera(fovDeg, 1, 0.1, distanceFor(0.25) * 4);
  camera.position.set(lookAt.x, lookAt.y, lookAt.z + distanceFor(1));
  camera.lookAt(lookAt);
  // กล้องวนรอบตัวละครในแนวนอน (azimuth 0 = มองตรงหน้า)
  let azimuth = 0;
  let camDist = distanceFor(1);

  // แปะหน้าการ์ตูน (วาดสีหน้าไม่ได้ผ่านกระดูกเพราะโมเดลนี้ไม่มี blendshape) ไว้เป็นลูกของ
  // กระดูกหัว หันไปทางกล้องเสมอ ตำแหน่ง/ขนาดคำนวณไว้ใน rig.faceCard (rig ใช้ค่าเดียวกันให้มือแตะหน้าได้พอดี)
  // โมเดล VRM มีหน้าจริงและ blendshape อยู่แล้ว จึงไม่แปะแผ่นหน้า
  const vrm = rig.vrm;
  const vrmFace = vrm ? findFaceMeshes(vrm) : null;
  const faceTex = vrm ? null : createFaceTexture();
  const faceMesh = faceTex ? createFaceMesh(faceTex.texture, rig.faceCard.size, rig.faceCard.offset, rig.headTiltAxis) : null;
  if (faceMesh) rig.bones.get(HEAD_BONE)!.add(faceMesh);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // VRM มีเส้นขอบบางและพื้นผิวละเอียด: บนจอปกติ (devicePixelRatio = 1) เส้นจะเป็นขั้นบันไดแตก จึงเรนเดอร์ที่ความละเอียด 2 เท่าขึ้นไปเสมอ
  // (CSS ย่อภาพลงเอง จึงเนียนเหมือนทำ supersampling) X Bot คงเดิม
  renderer.setPixelRatio(rig.vrm ? Math.min(Math.max(window.devicePixelRatio || 1, 2), 3) : Math.min(window.devicePixelRatio || 1, 2));
  if (rig.vrm) {
    // พื้นผิวเอียง (ผิวแขน ผม) คมขึ้นเมื่อมองเฉียง
    const aniso = renderer.capabilities.getMaxAnisotropy();
    rig.vrm.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
      if (mat?.map) mat.map.anisotropy = aniso;
    });
  }
  renderer.setClearColor(0x000000, 0);
  // ต้องกำหนด CSS ขนาดของ canvas เอง (setSize ตัวที่ 3 = false คือไม่ให้มันตั้งให้)
  // เพราะเราคุมขนาด "บัฟเฟอร์วาดภาพ" เองตาม devicePixelRatio อยู่แล้วในลูปด้านล่าง
  // ถ้าไม่กำหนดตรงนี้ บนจอ HiDPI (devicePixelRatio > 1) canvas จะแสดงผลใหญ่กว่ากล่องจริง
  // 2 เท่า แล้วโดนตัดขอบ (overflow-hidden) ทำให้ตัวละครดูเหมือนไม่อยู่กึ่งกลาง
  // วาง canvas แบบ absolute ด้วย ไม่ให้ขนาดบัฟเฟอร์ของมันไปดันขนาดกล่อง (บนมือถือเคยขยายวนจนกว้างหลายหมื่นพิกเซล)
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  // ลาก = หมุน (ถ้าแสดงแบบกระจก ภาพกลับซ้าย-ขวาอยู่แล้ว ต้องกลับทิศการลากด้วยให้รู้สึกตรงกับที่มือลาก)
  let dragX: number | null = null;
  const el = renderer.domElement;
  const onDown = (e: PointerEvent) => {
    dragX = e.clientX;
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (dragX === null) return;
    azimuth -= (e.clientX - dragX) * DRAG_RAD_PER_PX * (mirrorRef.current ? -1 : 1);
    dragX = e.clientX;
  };
  const onUp = () => {
    dragX = null;
  };
  const onReset = () => {
    azimuth = 0;
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("dblclick", onReset);

  let raf = 0;
  // การหมุนของกระดูกที่แสดงในเฟรมก่อน (ไว้ไล่ไปหาท่าใหม่แบบนุ่มนวล)
  const bones = posedBones(rig);
  let prevQuats: THREE.Quaternion[] | null = null;
  let lastNow = 0;
  // จำขนาดกล่องล่าสุดไว้เทียบเอง แทนที่จะอ่านจาก canvas.width/height ซึ่งเป็นพิกเซลอุปกรณ์
  // (คูณด้วย devicePixelRatio แล้ว) เทียบตรง ๆ กับ CSS px ไม่ได้ จะสั่ง setSize ทุกเฟรมโดยไม่จำเป็น
  let lastW = 0;
  let lastH = 0;
  const tick = (now: number) => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w && h) {
      if (w !== lastW || h !== lastH) {
        lastW = w;
        lastH = h;
        // กันบัฟเฟอร์ใหญ่เกินที่ GPU มือถือรับไหว (ถ้ากล่องผิดขนาดไปชั่วขณะ)
        renderer.setSize(Math.min(w, 2048), Math.min(h, 2048), false);
        camera.aspect = w / h;
        camDist = distanceFor(w / h);
        camera.updateProjectionMatrix();
      }
      // หายใจเบา ๆ ตอนไม่มีท่า ไม่ให้ตัวละครดูนิ่งค้าง (เหมือนตัว 2D เดิม)
      // สร้างอ็อบเจกต์ใหม่เสมอ ห้ามเขียนทับ hands.r/l ตรง ๆ เพราะ sampleMotion อาจคืนค่า
      // REST ตัวเดียวกันซ้ำ (ไม่ได้ clone) การเขียนทับจะไปเปลี่ยนค่าคงที่ REST ถาวร
      const base = sampleMotion(motionRef.current, progressRef.current);
      const sway = Math.sin(now / 900) * 0.004;
      const hands = {
        r: { ...base.r, y: base.r.y + sway },
        l: { ...base.l, y: base.l.y + sway },
      };
      const face = sampleFace(motionRef.current, progressRef.current);
      applyPose(rig, hands, face);
      // ไล่ท่าจากเฟรมก่อนไปหาท่าใหม่ (slerp) ตามเวลาที่ผ่านไป
      const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.1) : 0;
      lastNow = now;
      if (prevQuats && dt > 0) {
        const k = 1 - Math.exp(-dt / POSE_SMOOTH_SEC);
        bones.forEach((b, i) => b.quaternion.copy(prevQuats![i].slerp(b.quaternion, k)));
      }
      prevQuats = bones.map((b) => b.quaternion.clone());
      if (faceTex) drawFace(faceTex, face, now);
      if (vrm && vrmFace) {
        applyVrmFace(vrm, vrmFace, face, now);
        vrm.update(dt); // เขียน expression ลงเมช + ขยับสปริงผม/เสื้อผ้า
      }
      camera.position.set(lookAt.x + Math.sin(azimuth) * camDist, lookAt.y, lookAt.z + Math.cos(azimuth) * camDist);
      camera.lookAt(lookAt);
      lights.rotation.y = azimuth;
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("dblclick", onReset);
    renderer.dispose();
    scene.remove(rig.root);
    if (faceMesh && faceTex) {
      rig.bones.get(HEAD_BONE)!.remove(faceMesh);
      faceMesh.geometry.dispose();
      (faceMesh.material as THREE.MeshBasicMaterial).dispose();
      faceTex.texture.dispose();
    }
    // loadRig() เก็บ rig ไว้ใช้ซ้ำ จึงไม่ทำลายวัสดุ/เมชของ VRM ตอน unmount (ไม่งั้นเปิดหน้านี้รอบสองจะเป็นโมเดลเปล่า)
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
  };
}

