import { FilesetResolver, HolisticLandmarker } from "@mediapipe/tasks-vision";
import { HOLISTIC_MODEL_URL, MEDIAPIPE_WASM_URL } from "../../config/env";
import type { LandmarkFrame, Point } from "../../types";

// เก็บโมเดลที่โหลดแล้ว จะได้โหลดแค่ครั้งเดียว
let landmarkerPromise: Promise<HolisticLandmarker> | null = null;

// โหลดโมเดล Holistic (ลองใช้ GPU ก่อน ถ้าไม่ได้ใช้ CPU)
export function loadHolistic(): Promise<HolisticLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      const make = (delegate: "GPU" | "CPU") =>
        HolisticLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HOLISTIC_MODEL_URL, delegate },
          runningMode: "VIDEO",
          minPoseDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
        });
      try {
        return await make("GPU");
      } catch {
        return await make("CPU");
      }
    })().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

// แปลงผลของ MediaPipe เป็นรายการจุด x,y,z (คนแรกที่ตรวจเจอ)
const toPoints = (list?: Point[][]): Point[] =>
  list?.[0]?.map((p) => ({ x: p.x, y: p.y, z: p.z })) ?? [];

// เวลาล่าสุดที่ส่งให้โมเดล (MediaPipe ต้องการเวลาที่เพิ่มขึ้นเรื่อย ๆ ห้ามซ้ำ)
let lastTimestamp = 0;

// ตรวจจับท่าทางจากเฟรมวิดีโอหนึ่งเฟรม
export function detect(
  landmarker: HolisticLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): LandmarkFrame {
  lastTimestamp = Math.max(timestampMs, lastTimestamp + 1);
  const r = landmarker.detectForVideo(video, lastTimestamp);
  return {
    pose: toPoints(r.poseLandmarks),
    leftHand: toPoints(r.leftHandLandmarks),
    rightHand: toPoints(r.rightHandLandmarks),
    face: toPoints(r.faceLandmarks),
  };
}

// เส้นเชื่อมจุดของลำตัว มือ และใบหน้า (มาจาก MediaPipe)
export const POSE_CONNECTIONS = HolisticLandmarker.POSE_CONNECTIONS;
export const HAND_CONNECTIONS = HolisticLandmarker.HAND_CONNECTIONS;
export const FACE_CONTOURS = HolisticLandmarker.FACE_LANDMARKS_CONTOURS;
